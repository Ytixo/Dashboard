async function loadPartials() {
  const templates = [...document.querySelectorAll("template[data-include]")];
  await Promise.all(templates.map(async (template) => {
    const name = template.dataset.include;
    const response = await fetch(new URL(`partials/${name}.html`, document.baseURI));
    if (!response.ok) {
      throw new Error(`Partial introuvable: ${name}`);
    }
    template.outerHTML = await response.text();
  }));
}

loadPartials()
  .then(() => {
    window.dashboardBoot = "partials";
    return import("./js/main.js?v=20260509-2");
  })
  .then(({ initMain }) => {
    initMain();
    window.dashboardBoot = "ready";
  })
  .catch((error) => {
    window.dashboardBoot = "error";
    document.body.innerHTML = '<div class="empty-state">Impossible de charger les modules du dashboard.</div>';
    console.error(error);
  });
