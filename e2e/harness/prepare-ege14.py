"""Prepare the original EGE 14 materials for the local test course."""
import argparse
import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

import pdfplumber
from PIL import Image, ImageChops

SECTIONS = [
    ('notes', 'Конспект', '01 Конспект.pdf'),
    ('tasks', 'Задачи урока', '02 Задачи урока.pdf'),
    ('worksheet_tasks', 'Рабочий лист урока', '03 Рабочий лист урока.pdf'),
    ('worksheet_homework', 'ДЗ · задачи', '04 ДЗ - задачи.pdf'),
    ('worksheet_homework', 'ДЗ · рабочий лист', '05 ДЗ - рабочий лист.pdf'),
    ('solution', 'Решение ДЗ', '06 Решение ДЗ.pdf'),
]
DPI = 216
PADDING = 12


def marks(page):
    words = page.extract_words(x_tolerance=1)
    for left, right in zip(words, words[1:]):
        if left['text'] == 'Задача' and right['text'].isdigit() and abs(left['top'] - right['top']) < 2:
            yield int(right['text']), left['top'], max(left['bottom'], right['bottom'])


def crop_tasks(source, target, poppler):
    chunks = {}
    current = None
    with tempfile.TemporaryDirectory(dir=target) as tmp, pdfplumber.open(source) as document:
        prefix = Path(tmp) / 'page'
        subprocess.run(
            [poppler, '-r', str(DPI), '-png', str(source), str(prefix)],
            check=True, capture_output=True,
        )
        pages = sorted(Path(tmp).glob('page-*.png'))
        if len(pages) != len(document.pages):
            raise ValueError(f'Неверное число страниц: {source}')
        for page, path in zip(document.pages, pages):
            with Image.open(path) as rendered:
                image = rendered.convert('RGB')
            ratio = image.height / page.height
            starts = [(current, 0, 0), *marks(page), (None, page.height, page.height)]
            for ((number, _, content_y), (_, next_y, _)) in zip(starts, starts[1:]):
                if number is None or next_y <= content_y:
                    continue
                strip = image.crop((0, round(content_y * ratio) + 2, image.width, round(next_y * ratio) - 4))
                bounds = ImageChops.invert(strip.convert('L')).point(lambda pixel: 255 if pixel > 24 else 0).getbbox()
                if bounds:
                    _, y0, _, y1 = bounds
                    chunks.setdefault(number, []).append((strip.crop((0, y0, strip.width, y1)), bounds))
            current = starts[-2][0]

    if not chunks or list(chunks) != list(range(1, len(chunks) + 1)):
        raise ValueError(f'Не удалось определить номера задач: {source}')
    left = max(0, min(box[0] for fragments in chunks.values() for _, box in fragments) - PADDING)
    right = min(chunks[1][0][0].width, max(box[2] for fragments in chunks.values() for _, box in fragments) + PADDING)
    results = []
    for number, fragments in chunks.items():
        height = sum(strip.height for strip, _ in fragments) + PADDING * (len(fragments) + 1)
        condition = Image.new('RGB', (right - left, height), 'white')
        y = PADDING
        for strip, _ in fragments:
            condition.paste(strip.crop((left, 0, right, strip.height)), (0, y))
            y += strip.height + PADDING
        file_name = f'Задание №{number}.png'
        path = target / f'task-{number}.png'
        condition.save(path, optimize=True)
        results.append({'section': 'worksheet_homework', 'title': f'Задание №{number}', 'name': file_name, 'path': str(path)})
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path, help='Папка №14 с исходными уроками')
    parser.add_argument('output', type=Path, help='Папка для локального манифеста и изображений условий')
    parser.add_argument('--pdftoppm', default=shutil.which('pdftoppm') or 'pdftoppm')
    args = parser.parse_args()
    root = args.source.resolve(strict=True)
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    lessons = []
    for folder in sorted(root.iterdir()):
        match = re.fullmatch(r'Урок (\d{2}) - (.+)', folder.name)
        if not match or not folder.is_dir():
            continue
        index = int(match[1])
        target = output / f'lesson-{index:02}'
        target.mkdir(exist_ok=True)
        materials = [
            {'section': section, 'title': title, 'name': name, 'path': str((folder / name).resolve(strict=True))}
            for section, title, name in SECTIONS
        ]
        if index == 14:
            materials.extend(
                {'section': 'theory', 'title': file.stem, 'name': file.name, 'path': str(file)}
                for file in sorted((root / 'Теория и Шпаргалки').glob('*.pdf'))
            )
        conditions = crop_tasks(folder / SECTIONS[3][2], target, args.pdftoppm)
        lessons.append({'index': index, 'title': match[2], 'count': len(conditions), 'materials': materials + conditions})
    if [lesson['index'] for lesson in lessons] != list(range(1, 22)):
        raise ValueError('В папке №14 ожидаются уроки с 01 по 21.')
    path = output / 'ege14.json'
    path.write_text(json.dumps(lessons, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'21 lessons, {sum(lesson["count"] for lesson in lessons)} problems. Manifest: {path}')


if __name__ == '__main__':
    main()
