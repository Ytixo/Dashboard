async function loadPartials() {
  const templates = [...document.querySelectorAll("template[data-include]")];
  await Promise.all(templates.map(async (template) => {
    const response = await fetch(`partials/${template.dataset.include}.html`);
    template.outerHTML = await response.text();
  }));
}

try {
  await loadPartials();
  await import("./js/main.js");
} catch (error) {
  document.body.innerHTML = '<div class="empty-state">Lance le dashboard avec uvicorn pour charger les modules.</div>';
  console.error(error);
}
