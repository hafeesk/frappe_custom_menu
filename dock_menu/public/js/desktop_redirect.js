// Appended to Frappe's "desktop" page (the v16 apps page) by dock_menu's page_js hook:
// when the dock is on for this user, the apps page sends them to the dock Home page (or their
// workspace) instead of drawing itself, however they got there (login, /desk, the logo, a link).
(() => {
	const page = frappe.pages && frappe.pages["desktop"];
	if (!page || page._dm_redirect) return;
	page._dm_redirect = true;

	const pick = (t) => {
		const landing = (t && t.landing) || [];
		if (!t || !t.enabled || !landing.length) return null;
		let last = null;
		try {
			last = localStorage.getItem(t.style === "v14" ? "dm_last_workspace" : "dm_active");
		} catch (e) {}
		return ((landing.find((p) => p.name === last) || landing[0]) || {}).route || null;
	};
	const target = () =>
		frappe.boot && frappe.boot.dock_menu
			? Promise.resolve(frappe.boot.dock_menu)
			: frappe.xcall("dock_menu.api.home_target").then((t) => ((frappe.boot.dock_menu = t), t));

	const leave = (wrapper) => {
		$(wrapper).css("visibility", "hidden"); // no flash of the apps grid
		return target()
			.then((t) => {
				const r = pick(t);
				const here = window.location.pathname.replace(/\/+$/, "");
				if (!r || r.replace(/\/+$/, "") === here) return $(wrapper).css("visibility", "");
				(frappe.route_flags = frappe.route_flags || {}).replace_route = true;
				frappe.set_route(r);
				setTimeout(() => $(wrapper).css("visibility", ""), 1500);
			})
			.catch(() => $(wrapper).css("visibility", ""));
	};

	const on_load = page.on_page_load;
	page.on_page_load = function (wrapper) {
		leave(wrapper);
		return on_load && on_load.apply(this, arguments);
	};
	const on_show = page.on_page_show;
	page.on_page_show = function (wrapper) {
		leave(wrapper || page);
		return on_show && on_show.apply(this, arguments);
	};
})();
