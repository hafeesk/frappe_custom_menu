// Dock Menu — Home page.
//  /desk/dock-home              greeting + search, recently opened pages
//  /desk/dock-home/<workspace>  that workspace's menu straight away (header and recently opened are hidden),
//                               as cards: one per section / sub-workspace, each with its links.
// Clicking a workspace in the dock opens its page here.
(() => {
frappe.pages["dock-home"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({ parent: wrapper, title: __("Home"), single_column: true });
	$(wrapper).addClass("dmh-page");
	page.$dmh = $(`<div class="dmh"></div>`).appendTo(page.main);
	wrapper.dmh_page = page;
	load(page);
	$(document).on("dock_menu:changed", () => load(page));
	frappe.router.on("change", () => {
		if ((frappe.get_route() || [])[0] === "dock-home" && page.data) refresh_view(page);
	});
};

frappe.pages["dock-home"].on_page_show = function (wrapper) {
	const page = wrapper.dmh_page;
	if (page && page.data) refresh_view(page);
};

const dmh_esc = (s) => frappe.utils.escape_html(s == null ? "" : String(s));
const dmh_icon = (n, size = "sm") => (n ? frappe.utils.icon(n, size) : "");
const DM = () => window.dock_menu || {};
const dmh_link_icon = (l) =>
	l.icon && /^[a-z0-9-]+$/i.test(l.icon)
		? dmh_icon(l.icon)
		: dmh_icon({ report: "file-chart-column", page: "app-window", dashboard: "layout-dashboard", url: "external-link", workspace: "layout-grid", group: "folder" }[l.link_type] || "list");
const dmh_tile = (c) =>
	DM().tile
		? DM().tile(c)
		: `<span class="dm-tile" style="--dm-c:${dmh_esc(c.color || "#2F6FED")}"><b>${dmh_esc((c.label || "?").slice(0, 2).toUpperCase())}</b></span>`;

function load(page) {
	page.$dmh.html(`<div class="dmh-loading">${__("Loading...")}</div>`);
	frappe.xcall("dock_menu.api.get_home").then((data) => {
		page.data = data || {};
		render(page);
	});
}

function greeting() {
	const h = new Date().getHours();
	return h < 12 ? __("Good morning") : h < 17 ? __("Good afternoon") : __("Good evening");
}

// the static part: header (greeting + search) and recently opened, then the view below it
function render(page) {
	const d = page.data;
	if (!d.enabled) {
		page.$dmh.html(`<div class="dmh-empty">${__("The workspace menu is not enabled for you.")}</div>`);
		return;
	}
	const count = (d.cards || []).length;
	const date = new Date().toLocaleDateString(frappe.boot.lang || undefined, { weekday: "long", day: "numeric", month: "long" });
	page.$dmh.html(`
		<header class="dmh-hero">
			<div class="dmh-hello">
				<div class="dmh-date">${dmh_esc(date)}</div>
				<h1>${greeting()}, ${dmh_esc(d.first_name)}</h1>
				<div class="dmh-sub">${[d.subtitle, count ? __("{0} workspaces", [count]) : ""].filter(Boolean).map(dmh_esc).join(" · ")}</div>
			</div>
			<div class="dmh-search">
				<span class="dmh-search-icon">${dmh_icon("search")}</span>
				<input type="search" placeholder="${__("Search menus, reports and pages")}" aria-label="${__("Search")}" autocomplete="off">
				<kbd>/</kbd>
				<div class="dmh-results" hidden></div>
			</div>
		</header>
		<section class="dmh-recent-wrap"></section>
		<section class="dmh-view"></section>`);
	page.view = null;
	bind(page);
	refresh_view(page);
}

function refresh_view(page) {
	render_recent(page);
	const seg = (frappe.get_route() || [])[1] || "";
	// a workspace page shows its menu items directly: greeting, search and recently opened stay on Home only
	page.$dmh.toggleClass("dmh-on-ws", !!seg);
	if (page.view === seg && seg) return;
	page.view = seg;
	const $v = page.$dmh.find(".dmh-view");
	if (!seg) return $v.empty();
	$v.html(`<div class="dmh-loading">${__("Loading...")}</div>`);
	const dm = DM();
	(dm.ready || Promise.resolve(null)).then(() => {
		if (page.view !== seg) return;
		const it = dm.item_of_path && dm.item_of_path(decodeURIComponent(window.location.pathname).replace(/\/+$/, ""));
		if (!it) return $v.html(`<div class="dmh-empty">${__("This workspace is not available to you.")}</div>`);
		// a workspace page with its own shortcuts + link cards is drawn from them (v14 layout),
		// whatever sidebar / saved layout the dock menu uses; otherwise the dock's menu
		const own = it.workspace
			? frappe.xcall("dock_menu.api.get_workspace_layout", { workspace: it.workspace }).catch(() => null)
			: Promise.resolve(null);
		// a dashboard opens directly, and so does a menu that is just one link
		const open_direct = (route) => {
			(frappe.route_flags = frappe.route_flags || {}).replace_route = true;
			frappe.set_route(route);
		};
		const single = (m) => {
			const { quick, cards } = cards_of(m || {});
			const only = !cards.length && quick.length === 1 && !is_node(quick[0]) ? quick[0] : null;
			return only && only.route && !only.new_tab && !/^https?:/.test(only.route) ? only.route : null;
		};
		return own.then((lay) => {
			if (page.view !== seg) return;
			if (lay && lay.dashboard && (lay.route || it.route)) return open_direct(lay.route || it.route);
			if (lay && lay.blocks && lay.blocks.length) return draw_menu(page, it, lay);
			return dm.menu(it.key).then((m) => {
				if (page.view !== seg) return;
				const r = single(m);
				return r ? open_direct(r) : draw_menu(page, it, m || {});
			});
		});
	}).catch(() => $v.html(`<div class="dmh-empty">${__("Could not load this menu")}</div>`));
}

function render_recent(page) {
	const recent = (DM().recent && DM().recent()) || [];
	const $w = page.$dmh.find(".dmh-recent-wrap");
	if (!recent.length) return $w.empty();
	$w.html(`<div class="dmh-head"><h2>${__("Recently opened")}</h2></div>
		<div class="dmh-recent">${recent.slice(0, 8)
			.map((r) => `<a class="dmh-recent-item" href="${dmh_esc(r.route)}">
				<span class="dmh-li-icon">${dmh_icon(r.icon || "file-text")}</span>
				<span class="dmh-recent-text"><b>${dmh_esc(r.label)}</b><small>${dmh_esc(r.path || r.route)}</small></span></a>`)
			.join("")}</div>`);
}

// ------------------------------------------------------------------ workspace menu as cards
const kids_of = (l) => l.children || [];
const is_node = (l) => !!(l.group || kids_of(l).length || (l.lazy && l.ws));
const leaves = (links) => links.reduce((n, l) => n + (is_node(l) ? leaves(kids_of(l)) : 1), 0);

// a sub-workspace or group: groups among its children get their own card, plain links one card
function node_cards(n, eyebrow) {
	if (n.lazy && n.ws && !kids_of(n).length) return [{ title: n.label, icon: n.icon, eyebrow, lazy: n, links: [] }];
	const kids = kids_of(n);
	const plain = kids.filter((k) => !is_node(k));
	const groups = kids.filter((k) => is_node(k) && !(k.lazy && !kids_of(k).length));
	const subs = kids.filter((k) => k.lazy && k.ws && !kids_of(k).length);
	if (groups.length < 2 && !subs.length) return [{ title: n.label, icon: n.icon, eyebrow, route: n.group ? null : n.route, links: kids }];
	const out = [];
	if (plain.length) out.push({ title: n.label, icon: n.icon, eyebrow, route: n.group ? null : n.route, links: plain });
	groups.forEach((g) => out.push({ title: g.label, icon: g.icon, eyebrow: n.label, route: g.group ? null : g.route, links: kids_of(g) }));
	subs.forEach((s) => out.push({ title: s.label, icon: s.icon, eyebrow: n.label, lazy: s, links: [] }));
	return out;
}

function cards_of(m) {
	const quick = [], cards = [];
	(m.blocks || []).forEach((b) => {
		if (b.type === "spacer") return;
		if (b.type === "link") return is_node(b) ? cards.push(...node_cards(b)) : quick.push(b);
		const items = b.items || [];
		const plain = items.filter((l) => !is_node(l));
		if (plain.length) cards.push({ title: b.label || __("Links"), icon: b.icon, links: plain });
		items.filter(is_node).forEach((n) => cards.push(...node_cards(n, b.label)));
	});
	return { quick, cards };
}

function draw_menu(page, it, m) {
	const dm = DM();
	page.flat = [];
	page.ws_key = it.key;
	const { quick, cards } = cards_of(m);
	page.cards = cards;
	const total = leaves(quick) + cards.reduce((n, c) => n + leaves(c.links), 0);
	const lazy = cards.filter((c) => c.lazy).length;
	const meta = [total ? (total === 1 ? __("1 link") : __("{0} links", [total])) : "", lazy ? __("{0} sub-workspaces", [lazy]) : ""]
		.filter(Boolean).join(" · ");
	const color = dm.color ? dm.color(it) : it.color;
	// v14 layout: shortcuts on top, then link cards per module ("Reports & Masters"), each in its module's colour
	// every workspace page gets the colourful layout; the two section headings only when it has both parts
	const v14 = !!(quick.length && cards.length);
	page.$dmh.find(".dmh-view").html(`
		<div class="dmh-ws dmh-v14" style="--dm-c:${dmh_esc(color || "")}">
			<div class="dmh-ws-head">
				${dmh_tile(it)}
				<div class="dmh-ws-title"><h2>${dmh_esc(m.title || it.label)}</h2><small>${dmh_esc(meta)}</small></div>
				${dm.can_edit && dm.can_edit() ? `<button class="btn-reset dmh-btn dmh-ws-edit">${dmh_icon("pencil", "xs")}<span>${__("Edit menu")}</span></button>` : ""}
			</div>
			<div class="dmh-ws-find"><span class="dmh-search-icon">${dmh_icon("search")}</span>
				<input type="search" placeholder="${__("Filter {0}", [dmh_esc(m.title || it.label)])}" aria-label="${__("Filter this menu")}" autocomplete="off"></div>
			${quick_html(page, quick, v14)}
			${cards.length && (v14 || m.cards_head) ? `<div class="dmh-sec-h">${dmh_icon("layout-grid", "xs")}<span>${dmh_esc(m.cards_head || __("Reports & Masters"))}</span></div>` : ""}
			<div class="dmh-mgrid">${cards.map((c, i) => card_html(page, c, i, true)).join("")}</div>
			${!quick.length && !cards.length ? `<div class="dmh-empty">${__("Nothing in this menu yet.")}</div>` : ""}
		</div>`);
	page.$dmh.find(".dmh-mcard[data-lazy]").each((i, el) => load_card(page, el));
	paint_cards(page);
	paint_quick(page, quick);
}

// shortcuts under the workspace page's own headings (the heading above them on the page), in page order;
// without headings: one grid ("Your Shortcuts" when the page also has cards)
function quick_html(page, quick, titled) {
	if (!quick.length) return "";
	if (!quick.some((l) => l.head)) {
		return `${titled ? `<div class="dmh-sec-h">${dmh_icon("zap", "xs")}<span>${__("Your Shortcuts")}</span></div>` : ""}
			<div class="dmh-quick">${quick.map((l) => link_a(page, l, "dmh-qlink")).join("")}</div>`;
	}
	const groups = [];
	quick.forEach((l) => {
		const h = l.head || __("Shortcuts");
		let g = groups.find((x) => x.h === h);
		if (!g) groups.push((g = { h, links: [] }));
		g.links.push(l);
	});
	return `<div class="dmh-qgroups">${groups.map((g, i) => {
		const [color, ic] = card_style({ title: g.h }, i);
		return `<section class="dmh-qgroup" style="${mod_css(color)}">
			<div class="dmh-qhead"><span class="dmh-qhead-icon">${dmh_icon(ic || "layout-grid", "xs")}</span>
			<b>${dmh_esc(g.h)}</b><span class="dmh-qcount">${g.links.length}</span></div>
			<div class="dmh-quick">${g.links.map((l) => link_a(page, l, "dmh-qlink")).join("")}</div></section>`;
	}).join("")}</div>`;
}

// module colours / icons (the dock's palette); card titles like "Sales" / "Purchase" map to their module
const MOD_STYLE = {
	Selling: ["#6D4AE8", "shopping-cart"], Buying: ["#2F6FED", "truck"], Stock: ["#B4570B", "package"],
	Accounts: ["#0B6A85", "calculator"], HR: ["#2E9D72", "users"], Payroll: ["#3B8754", "wallet"],
	Projects: ["#1F4E8C", "folder-kanban"], Assets: ["#9E2A7A", "building-2"], Manufacturing: ["#B45309", "factory"],
	CRM: ["#C2410C", "handshake"], Subcontracting: ["#4F46E5", "boxes"], Support: ["#0E7490", "life-buoy"],
	"Quality Management": ["#15803D", "badge-check"], Maintenance: ["#78716C", "wrench"], Setup: ["#475569", "settings"],
	General: ["#6B7280", "layout-grid"],
};
const MOD_ALIAS = { Sales: "Selling", Purchase: "Buying", Purchasing: "Buying", Inventory: "Stock", Accounting: "Accounts",
	"Human Resources": "HR", Project: "Projects", Asset: "Assets", Quality: "Quality Management" };
const mod_key = (h) => {
	const k = Object.keys(MOD_STYLE).find((x) => __(x) === h || x === h);
	if (k) return k;
	const a = Object.keys(MOD_ALIAS).find((x) => __(x) === h || x === h);
	return a ? MOD_ALIAS[a] : null;
};
const mod_css = (c) => `--dm-c:${c};--dm-c-soft:color-mix(in srgb, ${c} 13%, var(--dm-surface))`;

const CARD_PALETTE = ["#2E9D72", "#2F6FED", "#6D4AE8", "#B4570B", "#0B6A85", "#9E2A7A", "#1F4E8C", "#3B8754"];
const card_style = (c, i) => {
	const k = c && mod_key(c.title);
	return k ? MOD_STYLE[k] : [CARD_PALETTE[i % CARD_PALETTE.length], null];
};
// cards: a module's card in that module's colour, the others in palette order; also sub-workspace cards once loaded
function paint_cards(page) {
	page.$dmh.find(".dmh-ws .dmh-mcard").each(function () {
		const i = +$(this).data("card");
		const [color, ic] = card_style(page.cards[i], i);
		$(this).attr("style", mod_css(color));
		if (ic) $(this).find(".dmh-mcard-icon").html(dmh_icon(ic));
	});
}
// shortcuts / loose links: the colour of the card that also lists them, else their module's colour;
// the card or module name under the label; live record count for documents
// live record count on document shortcuts
function paint_quick(page, quick) {
	const seg = page.view;
	quick.forEach((l) => {
		if (l.link_type !== "doctype" || l.doc_view === "New") return;
		const $l = page.$dmh.find(`.dmh-ws .dmh-qlink[data-li="${page.flat.indexOf(l)}"]`);
		frappe.db.count(l.link_to).then((n) => {
			if (page.view !== seg) return;
			$l.find(".dmh-q-count").remove();
			$l.append(`<span class="dmh-q-count">${dmh_esc(format_count(n))}</span>`);
		}).catch(() => null);
	});
}
const format_count = (n) => (n >= 100000 ? `${Math.round(n / 1000)}k` : n.toLocaleString());

// loose links (not in a section) are filed under headings by their module: Selling, Buying, Stock…
// inside a heading, documents come before reports
const QH_ORDER = ["Selling", "Buying", "Stock", "Accounts", "HR", "Payroll", "Projects", "Assets", "Manufacturing", "CRM",
	"Subcontracting", "Support", "Quality Management", "Maintenance", "Setup"];
function group_quick(page, quick) {
	const $q = page.$dmh.find(".dmh-ws > .dmh-quick");
	if (!$q.length) return;
	const seg = page.view;
	frappe.xcall("dock_menu.api.get_link_modules", { links: JSON.stringify(quick.map((l) => [l.link_type, l.link_to])) })
		.then((map) => {
			if (page.view !== seg || !$q.closest("body").length) return;
			const $a = $q.children(".dmh-qlink");
			const groups = new Map();
			quick.forEach((l, i) => {
				const h = (map || {})[`${String(l.link_type || "").toLowerCase()}:${l.link_to}`] || __("General");
				if (!groups.has(h)) groups.set(h, []);
				groups.get(h).push({ l, el: $a[i] });
			});
			const rank = (h) => {
				const i = QH_ORDER.findIndex((k) => __(k) === h);
				return h === __("General") ? 1e6 : i < 0 ? 1e3 : i;
			};
			const is_rep = (l) => (l.link_type === "report" ? 1 : 0);
			const $wrap = $(`<div class="dmh-qgroups"></div>`);
			[...groups.entries()]
				.sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
				.forEach(([h, arr]) => {
					arr.sort((x, y) => is_rep(x.l) - is_rep(y.l));
					const mk = mod_key(h);
					const $sec = $(`<section class="dmh-qgroup" ${mk ? `style="${mod_css(MOD_STYLE[mk][0])}"` : ""}>
						<div class="dmh-qhead"><span class="dmh-qhead-icon">${dmh_icon(mk ? MOD_STYLE[mk][1] : "folder", "xs")}</span>
						<b>${dmh_esc(h)}</b><span class="dmh-qcount">${arr.length}</span></div>
						<div class="dmh-quick"></div></section>`);
					const $grid = $sec.find(".dmh-quick");
					arr.forEach((x) => $grid.append(x.el));
					$wrap.append($sec);
				});
			$q.replaceWith($wrap);
			filter_view(page);
		})
		.catch(() => null);
}

function link_a(page, l, cls = "") {
	page.flat.push(l);
	return `<a class="dmh-mlink ${cls}" href="${dmh_esc(l.route || "#")}" data-li="${page.flat.length - 1}" ${l.new_tab ? 'target="_blank" rel="noopener"' : ""}>
		<span class="dmh-li-icon">${dmh_link_icon(l)}</span><span class="dmh-li-label">${dmh_esc(l.label)}</span></a>`;
}

function rows(page, links) {
	return links.map((l) => {
		if (l.lazy && l.ws && !kids_of(l).length)
			return `<li class="dmh-msub" data-ws="${dmh_esc(l.ws)}" ${l.own ? 'data-own="1"' : ""}>
				<button class="btn-reset dmh-msub-btn">${dmh_icon("chevron-right", "xs")}<span>${dmh_esc(l.label)}</span></button><ul></ul></li>`;
		if (is_node(l))
			return `<li class="dmh-mgroup"><div class="dmh-mgroup-title">${l.group || !l.route ? dmh_esc(l.label) : link_a(page, l)}</div>
				<ul>${rows(page, kids_of(l))}</ul></li>`;
		return `<li>${link_a(page, l)}</li>`;
	}).join("");
}

function card_html(page, c, i, split) {
	const n = leaves(c.links);
	const docs = c.links.filter((l) => !is_node(l) && l.link_type !== "report");
	const reps = c.links.filter((l) => !is_node(l) && l.link_type === "report");
	const body = split && !c.lazy && docs.length && reps.length && docs.length + reps.length === c.links.length
		? `<li class="dmh-msplit">${__("Masters")}</li>${rows(page, docs)}<li class="dmh-msplit">${__("Reports")}</li>${rows(page, reps)}`
		: null;
	return `<article class="dmh-mcard" data-card="${i}" ${c.lazy ? "data-lazy" : ""}>
		<header class="dmh-mcard-head">
			<span class="dmh-mcard-icon">${dmh_link_icon({ icon: c.icon, link_type: c.lazy ? "workspace" : "group" })}</span>
			<span class="dmh-mcard-title">${c.eyebrow ? `<small>${dmh_esc(c.eyebrow)}</small>` : ""}<b>${dmh_esc(c.title)}</b></span>
			<span class="dmh-mcard-count">${c.lazy ? "" : n}</span>
		</header>
		<ul class="dmh-mlinks">${c.lazy ? `<li class="dmh-mnote">${__("Loading...")}</li>` : body || rows(page, c.links)}</ul>
	</article>`;
}

// a sub-workspace card: fetch its menu, then replace the card with its cards
function load_card(page, el) {
	const c = page.cards[+$(el).data("card")];
	if (!c || !c.lazy) return;
	const key = page.ws_key;
	DM().submenu(c.lazy.ws, c.lazy.own).then((kids) => {
		if (page.ws_key !== key) return;
		const node = { ...c.lazy, lazy: 0, children: kids || [] };
		const parts = node_cards(node, c.eyebrow).filter((x) => x.lazy || leaves(x.links) || (x.links || []).length);
		if (!parts.length) {
			const why = DM().is_manager && DM().is_manager()
				? ` · <a href="#" class="dmh-why" data-ws="${dmh_esc(c.lazy.ws)}">${__("Why?")}</a>` : "";
			return $(el).find(".dmh-mlinks").html(`<li class="dmh-mnote">${__("Nothing in this menu")}${why}</li>`);
		}
		const html = parts.map((p) => {
			page.cards.push(p);
			return card_html(page, p, page.cards.length - 1, true);
		}).join("");
		const $new = $(html);
		$(el).replaceWith($new);
		paint_cards(page);
		$new.filter("[data-lazy]").each((i, x) => load_card(page, x));
		filter_view(page);
	}).catch(() => $(el).find(".dmh-mlinks").html(`<li class="dmh-mnote">${__("Could not load this menu")}</li>`));
}

function open_link(page, l) {
	if (!l || !l.route) return;
	if (/^https?:/.test(l.route) || l.new_tab) return window.open(l.route, "_blank", "noopener");
	const opts = DM().route_options ? DM().route_options(l) : null;
	if (DM().go_to) return DM().go_to(page.ws_key, l.route, opts);
	if (opts) frappe.route_options = opts;
	frappe.set_route(l.route);
}

// filter the open workspace menu: cards keep only matching links; a matching card title keeps all
const norm = (t) => String(t || "").toLowerCase();
function filter_view(page) {
	const $ws = page.$dmh.find(".dmh-ws");
	const q = norm($ws.find(".dmh-ws-find input").val()).trim();
	$ws.find(".dmh-f-hide").removeClass("dmh-f-hide");
	$ws.toggleClass("dmh-filtering", !!q);
	if (!q) return;
	const words = q.split(/\s+/);
	const hit = (t) => words.every((w) => norm(t).includes(w));
	$ws.find(".dmh-qlink").each(function () { $(this).toggleClass("dmh-f-hide", !hit($(this).text())); });
	$ws.find(".dmh-qgroup").each(function () {
		const $g = $(this);
		if (hit($g.find(".dmh-qhead b").text())) return $g.find(".dmh-f-hide").removeClass("dmh-f-hide");
		$g.toggleClass("dmh-f-hide", !$g.find(".dmh-qlink:not(.dmh-f-hide)").length);
	});
	$ws.find(".dmh-mcard").each(function () {
		const $c = $(this);
		if (hit($c.find(".dmh-mcard-title").text())) return;
		$c.find(".dmh-mlinks li").each(function () {
			const $li = $(this);
			if ($li.hasClass("dmh-mgroup") || $li.hasClass("dmh-msub") || $li.hasClass("dmh-msplit")) return $li.toggleClass("dmh-f-hide", $li.hasClass("dmh-msplit"));
			$li.toggleClass("dmh-f-hide", !hit($li.text()));
		});
		$c.find(".dmh-mgroup").each(function () {
			const $g = $(this);
			if (hit($g.children(".dmh-mgroup-title").text())) return $g.find(".dmh-f-hide").removeClass("dmh-f-hide");
			$g.toggleClass("dmh-f-hide", !$g.find("li:not(.dmh-mgroup):not(.dmh-f-hide)").length);
		});
		$c.find(".dmh-msub").each(function () { $(this).toggleClass("dmh-f-hide", !hit($(this).text())); });
		$c.toggleClass("dmh-f-hide", !$c.find(".dmh-mlinks li:not(.dmh-f-hide):not(.dmh-msplit)").length);
	});
}

function bind(page) {
	const $m = page.$dmh;
	$m.off(); // render() runs again after every edit: no duplicate handlers
	$m.on("click", ".dmh-mlink", function (e) {
		if (e.ctrlKey || e.metaKey || $(this).attr("target") === "_blank") return;
		e.preventDefault();
		open_link(page, (page.flat || [])[+$(this).data("li")]);
	});
	$m.on("click", ".dmh-msub-btn", function (e) {
		e.preventDefault();
		const $li = $(this).closest(".dmh-msub");
		const open = !$li.hasClass("is-open");
		$li.toggleClass("is-open", open);
		if (!open || $li.data("loaded")) return;
		$li.data("loaded", 1);
		const $ul = $li.children("ul").html(`<li class="dmh-mnote">${__("Loading...")}</li>`);
		DM().submenu($li.data("ws"), $li.data("own")).then((kids) => {
			$ul.html(rows(page, kids || []) || `<li class="dmh-mnote">${__("Nothing in this menu")}</li>`);
		});
	});
	$m.on("click", ".dmh-ws-edit", (e) => {
		e.preventDefault();
		if (DM().open_editor && page.ws_key) DM().open_editor(page.ws_key);
	});
	$m.on("click", ".dmh-why", function (e) {
		e.preventDefault();
		DM().explain && DM().explain($(this).data("ws"));
	});
	$m.on("input", ".dmh-ws-find input", () => filter_view(page));
	$m.on("keydown", ".dmh-ws-find input", function (e) {
		if (e.key === "Escape") $(this).val(""), filter_view(page);
		if (e.key === "Enter") {
			e.preventDefault();
			page.$dmh.find(".dmh-ws .dmh-mlink").filter((i, a) => !$(a).closest(".dmh-f-hide").length).first().trigger("click");
		}
	});
	$m.on("click", ".dmh-recent-item", function (e) {
		if (e.ctrlKey || e.metaKey) return;
		e.preventDefault();
		frappe.set_route($(this).attr("href"));
	});

	// search across every menu (the dock's index)
	const $in = $m.find(".dmh-search input");
	const $res = $m.find(".dmh-results");
	let hits = [];
	const show = () => {
		const q = norm($in.val()).trim();
		if (!q) return $res.prop("hidden", true).empty();
		const words = q.split(/\s+/);
		const idx = (DM().index && DM().index()) || [];
		hits = idx.filter((r) => words.every((w) => norm([r.label, r.app, ...(r.trail || [])].join(" ")).includes(w)))
			.sort((a, b) => (norm(b.label).includes(q) ? 1 : 0) - (norm(a.label).includes(q) ? 1 : 0))
			.slice(0, 12);
		$res.html(hits.length
			? hits.map((r, i) => `<a class="dmh-hit ${i ? "" : "is-first"}" href="${dmh_esc(r.route)}" data-hit="${i}">
				<span class="dmh-li-icon">${dmh_link_icon(r)}</span><span class="dmh-recent-text"><b>${dmh_esc(r.label)}</b>
				<small>${dmh_esc([r.app, ...(r.trail || [])].filter(Boolean).join(" › "))}</small></span></a>`).join("")
			: `<div class="dmh-noresult">${idx.length ? __("No matches") : __("Searching...")}</div>`).prop("hidden", false);
	};
	$in.on("focus", () => DM().load_index && DM().load_index().then(show));
	$in.on("input", show);
	$in.on("keydown", (e) => {
		if (e.key === "Enter" && hits[0]) (e.preventDefault(), open_hit(hits[0]));
		if (e.key === "Escape") $in.val(""), show();
	});
	$res.on("mousedown", ".dmh-hit", function (e) {
		e.preventDefault();
		open_hit(hits[+$(this).data("hit")]);
	});
	$in.on("blur", () => setTimeout(() => $res.prop("hidden", true), 150));
	const open_hit = (r) => {
		$in.val("");
		$res.prop("hidden", true);
		if (DM().open_hit) return DM().open_hit(r);
		frappe.set_route(r.route);
	};
	$(document).off("keydown.dmh").on("keydown.dmh", (e) => {
		if (e.key === "/" && !$(e.target).is("input, textarea, [contenteditable]") && $m.is(":visible")) {
			e.preventDefault();
			$in.trigger("focus");
		}
	});
}
})();
