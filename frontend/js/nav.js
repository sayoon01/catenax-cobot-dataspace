(function () {
  function setDrawerOpen(open) {
    const backdrop = document.getElementById("nav-backdrop");
    const drawer = document.getElementById("nav-drawer");
    const toggle = document.getElementById("nav-toggle");
    if (!backdrop || !drawer || !toggle) return;
    backdrop.classList.toggle("is-open", open);
    drawer.classList.toggle("is-open", open);
    backdrop.setAttribute("aria-hidden", open ? "false" : "true");
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    document.body.style.overflow = open ? "hidden" : "";
  }
  const toggle = document.getElementById("nav-toggle");
  const backdrop = document.getElementById("nav-backdrop");
  if (toggle) {
    toggle.addEventListener("click", () => {
      const drawer = document.getElementById("nav-drawer");
      if (drawer) setDrawerOpen(!drawer.classList.contains("is-open"));
    });
  }
  if (backdrop) backdrop.addEventListener("click", () => setDrawerOpen(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setDrawerOpen(false);
  });
})();
