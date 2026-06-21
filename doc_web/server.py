import io
import json
import os
import shutil
import subprocess
import tempfile
import threading
import uuid
import zipfile
from pathlib import Path
from urllib.parse import quote

import fitz
import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageDraw, ImageFont

BASE      = Path(__file__).parent
DATA      = BASE / "data"
SIGS      = DATA / "signatures"
STAMPS    = DATA / "stamps"
UPLOADS   = DATA / "uploads"
# Профиль LO — ОБЯЗАТЕЛЬНО в ASCII-пути (кириллика в пути ломает LO на Windows)
LO_PROF   = Path(tempfile.gettempdir()) / "doceditor_lo_profile"
CONFIG    = DATA / "config.json"
STATIC    = BASE / "static"

for d in [DATA, SIGS, STAMPS, UPLOADS, LO_PROF]:
    d.mkdir(parents=True, exist_ok=True)

_lo_lock = threading.Lock()   # предотвращает одновременный запуск двух процессов LO
if not CONFIG.exists():
    CONFIG.write_text(json.dumps({"initials": []}, ensure_ascii=False, indent=2))

sessions: dict[str, dict] = {}
app = FastAPI()

@app.middleware("http")
async def no_cache_static(request: Request, call_next):
    response = await call_next(request)
    p = request.url.path
    if p == "/" or p.endswith((".html", ".js", ".css")):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
        response.headers["Pragma"] = "no-cache"
    return response

# Форматы, конвертируемые в PDF через LibreOffice
OFFICE_EXT = {
    ".doc", ".docx", ".odt", ".rtf", ".txt",
    ".xls", ".xlsx", ".ods", ".csv",
    ".ppt", ".pptx", ".odp",
}


def find_soffice() -> str | None:
    """Найти исполняемый файл LibreOffice.
    На Windows soffice.exe — GUI-загрузчик (зависает в терминале).
    soffice.com — консольная версия, работает корректно в headless-режиме.
    """
    # На Windows ищем .com первым — он не зависает в терминале
    candidates = [
        r"C:\Program Files\LibreOffice\program\soffice.com",
        r"C:\Program Files (x86)\LibreOffice\program\soffice.com",
        r"C:\Program Files\LibreOffice\program\soffice.exe",
        r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
    ]
    for c in candidates:
        if Path(c).exists():
            return c
    # Fallback: поиск в PATH (Linux/Mac)
    return shutil.which("soffice")


def convert_to_pdf(data: bytes, filename: str) -> bytes:
    """Конвертировать офисный документ в PDF через LibreOffice headless."""
    soffice = find_soffice()
    if not soffice:
        raise HTTPException(
            422,
            "Для открытия Word/Excel/PowerPoint нужен LibreOffice. "
            "Установите его с libreoffice.org и перезапустите сервер.",
        )

    # Только один процесс LO одновременно — иначе конфликт профилей
    with _lo_lock:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            # Безопасное ASCII-имя файла — LO на Windows иногда не читает кириллику
            safe_name = "doc" + Path(filename).suffix.lower()
            src = tmp_path / safe_name
            src.write_bytes(data)

            # Постоянный профиль (LO_PROF) — инициализируется 1 раз, потом мгновенно
            prof_uri = LO_PROF.as_uri()
            # Удаляем устаревшие lock-файлы (могут остаться после краша LO)
            for lf in LO_PROF.rglob(".~lock*"):
                try: lf.unlink()
                except OSError: pass
            proc = None
            try:
                proc = subprocess.Popen(
                    [soffice,
                     f"-env:UserInstallation={prof_uri}",
                     "--headless", "--invisible",
                     "--nocrashreport", "--nofirststartwizard",
                     "--nologo", "--norestore",
                     "--convert-to", "pdf",
                     "--outdir", str(tmp_path), str(src)],
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                )
                _, stderr = proc.communicate(timeout=90)
                if proc.returncode != 0:
                    msg = stderr.decode("utf-8", "ignore")[:300]
                    raise HTTPException(500, f"Ошибка конвертации LibreOffice: {msg}")
            except subprocess.TimeoutExpired:
                if proc:
                    proc.kill()
                    proc.communicate()
                raise HTTPException(500, "Конвертация заняла слишком долго (>90 с). Попробуйте ещё раз.")

            # Ищем любой PDF в папке (LO может переименовать файл)
            pdfs = list(tmp_path.glob("*.pdf"))
            if not pdfs:
                raise HTTPException(500, "LibreOffice не создал PDF — файл повреждён или формат не поддерживается")
            return pdfs[0].read_bytes()


def load_cfg():
    raw = CONFIG.read_bytes()
    for enc in ("utf-8", "cp1251"):
        try:
            return json.loads(raw.decode(enc))
        except (UnicodeDecodeError, json.JSONDecodeError):
            continue
    return {"initials": []}

def save_cfg(c):
    CONFIG.write_text(json.dumps(c, ensure_ascii=False, indent=2), encoding="utf-8")


# ── Upload ────────────────────────────────────────────────────────────────────

def _add_source(s: dict, data: bytes, filename: str) -> list:
    """Добавить файл как новый источник; вернуть список новых записей order."""
    ext = Path(filename).suffix.lower()
    if ext in OFFICE_EXT:
        data = convert_to_pdf(data, filename)
        ext  = ".pdf"

    doc_idx = len(s["sources"])
    uid_part = f"{uuid.uuid4().hex[:8]}"

    if ext == ".pdf":
        try:
            doc = fitz.open(stream=data, filetype="pdf")
            pg  = doc.page_count
            doc.close()
        except Exception as e:
            raise HTTPException(400, f"Не удалось прочитать PDF: {e}")
        if pg == 0:
            raise HTTPException(400, "PDF не содержит страниц (возможно, файл пустой или конвертация не удалась)")
        path = UPLOADS / f"{uid_part}.pdf"
        path.write_bytes(data)
        s["sources"].append({"type": "pdf", "path": str(path)})
        return [{"doc": doc_idx, "src": i, "rot": 0} for i in range(pg)]

    elif ext in {".png", ".jpg", ".jpeg", ".bmp"}:
        path = UPLOADS / f"{uid_part}{ext}"
        path.write_bytes(data)
        s["sources"].append({"type": "image", "path": str(path)})
        return [{"doc": doc_idx, "src": 0, "rot": 0}]

    raise HTTPException(400, "Формат не поддерживается")


@app.post("/api/upload")
async def upload(file: UploadFile = File(...)):
    data = await file.read()
    sid  = str(uuid.uuid4())
    s = {"name": file.filename, "sources": [], "order": []}
    s["order"] = _add_source(s, data, file.filename)
    sessions[sid] = s
    return {"sid": sid, "pages": len(s["order"]), "name": file.filename}


@app.post("/api/append/{sid}")
async def append_file(sid: str, file: UploadFile = File(...), at: int = Form(-1)):
    s = sessions.get(sid)
    if not s:
        raise HTTPException(404)
    data = await file.read()
    new_entries = _add_source(s, data, file.filename)
    order = s["order"]
    if at is None or at < 0 or at > len(order):
        insert_at = len(order)
    else:
        insert_at = at
    order[insert_at:insert_at] = new_entries     # вставка в позицию
    return {"pages": len(order), "added": len(new_entries), "at": insert_at}


# ── Page render ───────────────────────────────────────────────────────────────

def _render(s: dict, n: int, scale: float, thumb: bool) -> bytes:
    order = s["order"]
    if n < 0 or n >= len(order):
        raise HTTPException(404)
    entry = order[n]
    rot   = entry.get("rot", 0)
    src   = s["sources"][entry.get("doc", 0)]

    if src["type"] == "pdf":
        pdf_bytes = Path(src["path"]).read_bytes()
        doc  = fitz.open(stream=pdf_bytes, filetype="pdf")
        page = doc[entry["src"]]
        page.set_rotation(rot)
        sc   = 0.3 if thumb else scale
        # рендерим с альфа-каналом и накладываем на белый фон
        pix  = page.get_pixmap(matrix=fitz.Matrix(sc, sc), alpha=True)
        img  = Image.frombytes("RGBA", [pix.width, pix.height], pix.samples)
        bg   = Image.new("RGB", img.size, (255, 255, 255))
        bg.paste(img, mask=img.split()[3])
        buf  = io.BytesIO()
        bg.save(buf, "JPEG", quality=80 if thumb else 92)
        doc.close()
        return buf.getvalue()
    else:
        img = Image.open(src["path"]).convert("RGB")
        if rot:
            img = img.rotate(-rot, expand=True)   # rot по часовой
        if thumb:
            img.thumbnail((120, 160))
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=80 if thumb else 92)
        return buf.getvalue()


@app.get("/api/page/{sid}/{n}")
def get_page(sid: str, n: int, scale: float = 2.0):
    s = sessions.get(sid)
    if not s:
        raise HTTPException(404)
    data = _render(s, n, scale, thumb=False)
    return StreamingResponse(io.BytesIO(data), media_type="image/jpeg")


@app.get("/api/thumb/{sid}/{n}")
def get_thumb(sid: str, n: int):
    s = sessions.get(sid)
    if not s:
        raise HTTPException(404)
    data = _render(s, n, 2.0, thumb=True)
    return StreamingResponse(io.BytesIO(data), media_type="image/jpeg")


# ── Page operations (duplicate / rotate / delete) ─────────────────────────────

@app.post("/api/page_op/{sid}")
async def page_op(sid: str, payload: dict):
    s = sessions.get(sid)
    if not s:
        raise HTTPException(404)
    order = s["order"]
    op   = payload.get("op")
    n    = int(payload.get("page", 0))

    if op == "move":
        to = int(payload.get("to", 0))
        if not (0 <= n < len(order)):
            raise HTTPException(400, "Неверный индекс страницы")
        # to может быть равен len(order) — Python insert() поставит в конец
        to = max(0, min(to, len(order) - 1))
        if n == to:
            return {"pages": len(order)}
        item = order.pop(n)
        order.insert(to, item)
        return {"pages": len(order)}

    if n < 0 or n >= len(order):
        raise HTTPException(400, "Нет такой страницы")

    if op == "duplicate":
        order.insert(n + 1, dict(order[n]))
    elif op == "delete":
        del order[n]
    elif op == "rotate_cw":
        order[n]["rot"] = (order[n].get("rot", 0) + 90) % 360
    elif op == "rotate_ccw":
        order[n]["rot"] = (order[n].get("rot", 0) - 90) % 360
    else:
        raise HTTPException(400, "Неизвестная операция")

    return {"pages": len(order)}


# ── Export ────────────────────────────────────────────────────────────────────

def _content_disposition(name: str) -> str:
    """Заголовок с поддержкой кириллицы (RFC 5987 + ASCII-запаска)."""
    ascii_name = name.encode("ascii", "ignore").decode("ascii") or "document"
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(name)}"


def bake_pdf(s: dict, pages_data: list, scale: float) -> bytes:
    """Собрать итоговый PDF с запечёнными наложениями."""
    def to_pt(v):
        return float(v)          # координаты уже в точках PDF

    order = s["order"]
    src_docs: dict[int, fitz.Document] = {}   # кэш открытых исходных PDF

    def get_src_doc(di):
        if di not in src_docs:
            pdf_bytes = Path(s["sources"][di]["path"]).read_bytes()
            src_docs[di] = fitz.open(stream=pdf_bytes, filetype="pdf")
        return src_docs[di]

    out_doc = fitz.open()

    for page_idx, entry in enumerate(order):
        elements = pages_data[page_idx] if page_idx < len(pages_data) else []
        rot      = entry.get("rot", 0)
        di       = entry.get("doc", 0)
        src_type = s["sources"][di]["type"]

        if src_type == "pdf":
            src_doc = get_src_doc(di)
            src = entry["src"]
            if rot == 0:
                sp   = src_doc[src]
                w, h = sp.rect.width, sp.rect.height
                page = out_doc.new_page(width=w, height=h)
                page.show_pdf_page(page.rect, src_doc, src)
            else:
                sp = src_doc[src]
                sp.set_rotation(rot)
                pix = sp.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
                w, h = pix.width / scale, pix.height / scale
                page = out_doc.new_page(width=w, height=h)
                page.insert_image(page.rect, stream=pix.tobytes("png"))
        else:
            img = Image.open(s["sources"][di]["path"]).convert("RGB")
            if rot:
                img = img.rotate(-rot, expand=True)
            iw, ih = img.size
            w  = iw / scale
            h  = ih / scale
            page = out_doc.new_page(width=w, height=h)
            buf = io.BytesIO(); img.save(buf, "PNG")
            page.insert_image(page.rect, stream=buf.getvalue())

        for el in elements:
            kind = el.get("type")
            x    = to_pt(el.get("x", 0))
            y    = to_pt(el.get("y", 0))

            if kind in ("text", "date", "ini"):
                text      = el.get("text", "")
                font_size = float(el.get("size", 16))
                color_hex = el.get("color", "#000000").lstrip("#")
                r = int(color_hex[0:2], 16) / 255
                g = int(color_hex[2:4], 16) / 255
                b = int(color_hex[4:6], 16) / 255
                bold   = el.get("bold",   False)
                italic = el.get("italic", False)

                if bold:
                    fname = "hebo"
                elif italic:
                    fname = "heit"
                else:
                    fname = "helv"

                lines   = text.split("\n")
                lh      = font_size * 1.35
                for i, line in enumerate(lines):
                    if line:
                        by = y + font_size + i * lh   # baseline = top + font_size
                        page.insert_text((x, by), line,
                                         fontname=fname,
                                         fontsize=font_size,
                                         color=(r, g, b))

            elif kind == "draw":
                import base64 as _b64
                data_url = el.get("dataUrl", "")
                if data_url.startswith("data:image/png;base64,"):
                    png = _b64.b64decode(data_url.split(",", 1)[1])
                    rect = fitz.Rect(0, 0, page.rect.width, page.rect.height)
                    page.insert_image(rect, stream=png, overlay=True)

            elif kind in ("sig", "stamp"):
                img_path = el.get("imgPath")
                ew = float(el.get("w", 150))
                eh = float(el.get("h",  60))
                if img_path and Path(img_path).exists():
                    rect = fitz.Rect(x, y, x + ew, y + eh)
                    page.insert_image(rect, filename=img_path, overlay=True)

    buf = io.BytesIO()
    out_doc.save(buf)
    out_doc.close()
    for d in src_docs.values():
        d.close()
    return buf.getvalue()


def pdf_to_images(pdf_bytes: bytes, fmt: str, dpi_scale: float = 2.0):
    """Вернуть список (имя, байты) изображений по странице PDF."""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    pil_fmt = "PNG" if fmt == "png" else "JPEG"
    out = []
    for i in range(doc.page_count):
        pix = doc[i].get_pixmap(matrix=fitz.Matrix(dpi_scale, dpi_scale), alpha=False)
        img = Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")
        b = io.BytesIO()
        img.save(b, pil_fmt, quality=92)
        out.append((f"page_{i+1}.{fmt}", b.getvalue()))
    doc.close()
    return out


def pdf_to_office(pdf_bytes: bytes, target: str) -> bytes:
    """Конвертировать PDF в docx/xlsx через LibreOffice."""
    soffice = find_soffice()
    if not soffice:
        raise HTTPException(
            422,
            "Для экспорта в Word/Excel нужен LibreOffice. "
            "Установите его с libreoffice.org и перезапустите сервер.",
        )
    with tempfile.TemporaryDirectory() as tmp:
        tp  = Path(tmp)
        src = tp / "doc.pdf"
        src.write_bytes(pdf_bytes)
        prof = (tp / "lo_profile").as_uri()
        # фильтр инфографики: pdf → docx/xlsx
        filt = "docx:MS Word 2007 XML" if target == "docx" else "xlsx:Calc MS Excel 2007 XML"
        try:
            subprocess.run(
                [soffice, f"-env:UserInstallation={prof}", "--headless", "--norestore",
                 "--infilter=writer_pdf_import", "--convert-to", filt,
                 "--outdir", str(tp), str(src)],
                check=True, timeout=120,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            )
        except subprocess.TimeoutExpired:
            raise HTTPException(500, "Конвертация заняла слишком долго")
        except subprocess.CalledProcessError as e:
            raise HTTPException(500, f"Ошибка конвертации: {e.stderr.decode('utf-8','ignore')[:300]}")
        res = src.with_suffix("." + target)
        if not res.exists():
            raise HTTPException(500, "LibreOffice не создал файл")
        return res.read_bytes()


@app.post("/api/export")
async def export_doc(payload: dict):
    sid        = payload.get("sid")
    pages_data = payload.get("pages", [])
    scale      = float(payload.get("scale", 2.0))
    fmt        = (payload.get("format") or "pdf").lower()
    s          = sessions.get(sid)
    if not s:
        raise HTTPException(404)

    pdf_bytes = bake_pdf(s, pages_data, scale)
    stem = Path(s["name"]).stem

    if fmt == "pdf":
        return StreamingResponse(io.BytesIO(pdf_bytes), media_type="application/pdf",
                                 headers={"Content-Disposition": _content_disposition(stem + ".pdf")})

    if fmt in ("png", "jpg"):
        images = pdf_to_images(pdf_bytes, "jpg" if fmt == "jpg" else "png")
        if len(images) == 1:
            name, data = images[0]
            mt = "image/png" if fmt == "png" else "image/jpeg"
            return StreamingResponse(io.BytesIO(data), media_type=mt,
                                     headers={"Content-Disposition": _content_disposition(f"{stem}.{fmt}")})
        # несколько страниц → ZIP
        zbuf = io.BytesIO()
        with zipfile.ZipFile(zbuf, "w", zipfile.ZIP_DEFLATED) as z:
            for name, data in images:
                z.writestr(name, data)
        return StreamingResponse(io.BytesIO(zbuf.getvalue()), media_type="application/zip",
                                 headers={"Content-Disposition": _content_disposition(f"{stem}_{fmt}.zip")})

    if fmt in ("docx", "xlsx"):
        data = pdf_to_office(pdf_bytes, fmt)
        mt = ("application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              if fmt == "docx" else
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        return StreamingResponse(io.BytesIO(data), media_type=mt,
                                 headers={"Content-Disposition": _content_disposition(f"{stem}.{fmt}")})

    raise HTTPException(400, "Неизвестный формат")


# ── Signatures ────────────────────────────────────────────────────────────────

@app.get("/api/signatures")
def list_sigs():
    return [{"name": f.stem, "path": f"/api/signatures/file/{f.name}"}
            for f in sorted(SIGS.glob("*.png"))]

@app.post("/api/signatures")
async def save_sig(name: str = Form(...), file: UploadFile = File(...)):
    safe = name.replace("/", "_").replace("\\", "_")
    (SIGS / f"{safe}.png").write_bytes(await file.read())
    return {"name": safe, "path": f"/api/signatures/file/{safe}.png"}

@app.get("/api/signatures/file/{fn}")
def get_sig_file(fn: str):
    p = SIGS / fn
    if not p.exists(): raise HTTPException(404)
    return FileResponse(p)

@app.delete("/api/signatures/{name}")
def del_sig(name: str):
    p = SIGS / f"{name}.png"
    if p.exists(): p.unlink()
    return {"ok": True}


# ── Initials ──────────────────────────────────────────────────────────────────

@app.get("/api/initials")
def list_inis():
    return load_cfg().get("initials", [])

@app.post("/api/initials")
async def save_ini(payload: dict):
    cfg = load_cfg()
    inis = [i for i in cfg.get("initials", []) if i["name"] != payload["name"]]
    inis.append({"name": payload["name"], "text": payload["text"]})
    cfg["initials"] = inis
    save_cfg(cfg)
    return {"ok": True}

@app.delete("/api/initials/{name}")
def del_ini(name: str):
    cfg = load_cfg()
    cfg["initials"] = [i for i in cfg.get("initials", []) if i["name"] != name]
    save_cfg(cfg)
    return {"ok": True}


# ── Stamps ────────────────────────────────────────────────────────────────────

@app.get("/api/stamps")
def list_stamps():
    return [{"name": f.stem, "path": f"/api/stamps/file/{f.name}"}
            for f in sorted(STAMPS.glob("*.png"))]

@app.post("/api/stamps/text")
async def create_txt_stamp(payload: dict):
    text  = payload.get("text", "ПЕЧАТЬ")
    color = payload.get("color", "#CC0000")
    name  = payload.get("name",  "stamp")
    r, g, b = int(color[1:3],16), int(color[3:5],16), int(color[5:7],16)

    try:
        font = ImageFont.truetype("arial.ttf", 32)
    except Exception:
        font = ImageFont.load_default()

    dummy = Image.new("RGBA", (1, 1))
    dd = ImageDraw.Draw(dummy)
    bbox = dd.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]

    img  = Image.new("RGBA", (tw + 40, th + 40), (255, 255, 255, 0))
    draw = ImageDraw.Draw(img)
    draw.rectangle([2, 2, tw + 37, th + 37], outline=(r, g, b, 255), width=3)
    draw.text((20, 20), text, fill=(r, g, b, 255), font=font)

    safe = name.replace("/", "_").replace("\\", "_")
    buf = io.BytesIO()
    img.save(buf, "PNG")
    (STAMPS / f"{safe}.png").write_bytes(buf.getvalue())
    return {"name": safe, "path": f"/api/stamps/file/{safe}.png"}

@app.post("/api/stamps/upload")
async def upload_stamp(name: str = Form(...), file: UploadFile = File(...)):
    safe = name.replace("/", "_").replace("\\", "_")
    (STAMPS / f"{safe}.png").write_bytes(await file.read())
    return {"name": safe, "path": f"/api/stamps/file/{safe}.png"}

@app.get("/api/stamps/file/{fn}")
def get_stamp_file(fn: str):
    p = STAMPS / fn
    if not p.exists(): raise HTTPException(404)
    return FileResponse(p)

@app.delete("/api/stamps/{name}")
def del_stamp(name: str):
    p = STAMPS / f"{name}.png"
    if p.exists(): p.unlink()
    return {"ok": True}


# ── Static ────────────────────────────────────────────────────────────────────

app.mount("/", StaticFiles(directory=str(STATIC), html=True), name="static")

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000, reload=False)
