(function () {
  var shkolkovoPdfDelayMs = 1200;

  function clean(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
      .trim()
      .slice(0, 180);
  }

  function visibleText(el) {
    if (!el) return "";
    var style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return "";
    return clean(el.textContent);
  }

  var lessonTitle = (function () {
    var h1Titles = Array.prototype.slice.call(document.querySelectorAll("h1"))
      .map(visibleText)
      .filter(Boolean);
    var title =
      h1Titles[0] ||
      visibleText(document.querySelector('[class*="lesson"] h1, [class*="Lesson"] h1')) ||
      clean(document.title);

    return title
      .replace(/^Видео-конспект\s*\|\s*/i, "")
      .replace(/\s+-\s+Школково.*$/i, "")
      .trim();
  })();

  function endsWith(value, suffix) {
    return value.slice(-suffix.length) === suffix;
  }

  function pad2(value) {
    value = String(value);
    return value.length < 2 ? "0" + value : value;
  }

  function downloadNext(index, links, lessonTitle) {
    if (index >= links.length) {
      console.log("Готово. Если браузер спросил разрешение на множественные загрузки, разреши и запусти скрипт еще раз.");
      return;
    }

    var item = links[index];
    var a = document.createElement("a");
    a.href = item.url;
    a.download = pad2(item.index) + " - " + (lessonTitle ? lessonTitle + " - " : "") + item.title;
    a.target = "_blank";
    a.rel = "noreferrer";
    document.body.appendChild(a);
    a.click();
    a.remove();
    console.log("Скачивание " + item.index + "/" + links.length + ": " + item.title);

    setTimeout(function () {
      downloadNext(index + 1, links, lessonTitle);
    }, shkolkovoPdfDelayMs);
  }

  var links = Array.prototype.slice.call(
    document.querySelectorAll('a[href$=".pdf"], a[href*=".pdf?"]')
  )
    .map(function (a, index) {
      var title =
        clean(a.textContent) ||
        clean(decodeURIComponent(new URL(a.href, location.href).pathname.split("/").pop())) ||
        "shkolkovo-" + (index + 1) + ".pdf";

      return {
        index: index + 1,
        title: endsWith(title, ".pdf") ? title : title + ".pdf",
        url: new URL(a.getAttribute("href"), location.href).href,
      };
    })
    .filter(function (item, index, array) {
      var firstSameUrl = array.findIndex(function (other) {
        return other.url === item.url;
      });
      return firstSameUrl === index;
    });

  if (!links.length) {
    console.warn("PDF-ссылки на этой странице не найдены. Открой страницу ДЗ после нажатия «Приступить к домашнему заданию».");
    return;
  }

  console.log("Урок: " + (lessonTitle || "название не найдено"));
  console.table(links);
  console.log("Найдено PDF: " + links.length + ". Начинаю скачивание с паузой " + shkolkovoPdfDelayMs + " мс.");
  downloadNext(0, links, lessonTitle);
})();
