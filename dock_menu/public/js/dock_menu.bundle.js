// Dock Menu — Frappe v16
//  • Dock (left rail): Home, one icon per workspace the user's roles allow, "More", then
//    Search, Notifications (with unread badge) and ToDo
//  • Sidebar: header (icon · title · company) with a switcher, links and collapsible sections
//    taken from the v16 Workspace Sidebar (or the workspace's cards), active link highlighted
//  • Clicking the active dock icon (or Ctrl+B) hides / shows the sidebar
(() => {
	const API = "dock_menu.api.";
	const KEY_ACTIVE = "dm_active";
	const KEY_COLLAPSED = "dm_collapsed";
	const KEY_CLOSED = "dm_closed_sections";
	const KEY_LAST_WS = "dm_last_workspace"; // v14: localStorage.current_page
	const KEY_OPEN_NODES = "dm_open_nodes";
	const KEY_RECENT = "dm_recent";
	const HOME = "/desk/dock-home";
	// always-expanded dock: icons with their names; a workspace's menu opens on the Home page
	// (/desk/dock-home/<workspace>) instead of the sidebar panel, which stays hidden
	const NO_PANEL = true;
	const KEY_MINI = "dm_dock_mini"; // expanded dock minimized to an icon rail (per browser)
	const key_slug = (k) => String(k || "").toLowerCase().replace(/^(ws|app|dock|item):/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
	const ws_route = (k) => `${HOME}/${key_slug(k)}`;
	// these workspaces open their own page (headings + shortcuts) straight from the dock, not the menu page
	const DIRECT_WS = [];
	const opens_page = (it) => !!(it && it.route && DIRECT_WS.some((n) => n === it.workspace || n === it.label));
	const dock_href = (it) => (NO_PANEL && !opens_page(it) ? ws_route(it.key) : it.route || "#");
	const key_of_path = (p) => {
		if (!p.startsWith(HOME + "/")) return null;
		const seg = p.slice(HOME.length + 1).split("/")[0];
		const it = ((S && S.items) || []).find((x) => key_slug(x.key) === seg);
		return it ? it.key : null;
	};
	let ready_done;
	const READY = new Promise((r) => (ready_done = r));
	const PALETTE = ["#1E3A5F", "#6B7280", "#2F6FED", "#1F4E8C", "#2E9D72", "#3B8754", "#6D4AE8", "#B4570B", "#0B6A85", "#9E2A7A"];

	const S = { cfg: null, items: [], menus: {}, active: null, located: {}, sub: {}, index: null };

	// ------------------------------------------------------------------ utils
	const store = (k, v) => {
		try {
			if (v === undefined) return window.localStorage.getItem(k);
			v === null ? window.localStorage.removeItem(k) : window.localStorage.setItem(k, v);
		} catch (e) {
			return null;
		}
	};
	const esc = (s) => frappe.utils.escape_html(s == null ? "" : String(s));
	const icon = (name, size = "sm") => (name ? frappe.utils.icon(name, size) : "");
	const call = (m, args, type = "GET") => frappe.xcall(API + m, args || {}, type);
	const hash = (s) => {
		let h = 0;
		for (const ch of s || "") h = (h * 31 + ch.charCodeAt(0)) >>> 0;
		return h;
	};
	const color_of = (it) => it.color || PALETTE[hash(it.label) % PALETTE.length];
	const is_emoji = (s) => !!s && !/^[a-z0-9-]+$/i.test(s);
	// a private workspace can be addressed by full name or by title (newer v16 rewrites to the title)
	const path_now = () => {
		const p = decodeURIComponent(window.location.pathname).replace(/\/+$/, "") || "/";
		const hit = ((S.cfg && S.cfg.landing) || []).find((x) => x.alias && (p === x.alias || p.startsWith(x.alias + "/")));
		return hit ? hit.route + p.slice(hit.alias.length) : p;
	};
	const matches = (path, route) => {
		if (!route || !route.startsWith("/")) return 0;
		route = route.replace(/\/+$/, "");
		return path === route || path.startsWith(route + "/") ? route.length : 0;
	};

	// Lucide panel-left-close / panel-left-open (not in Frappe's icon sprite)
	const PANEL_SVG = (arrow) =>
		`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="${arrow}"/></svg>`;
	const ICON_HIDE = PANEL_SVG("m16 15-3-3 3-3");
	const ICON_SHOW = PANEL_SVG("m14 9 3 3-3 3");
	// Lucide move-horizontal: toggle full-width pages
	const ICON_WIDTH = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
		<path d="m18 8 4 4-4 4"/><path d="M2 12h20"/><path d="m6 8-4 4 4 4"/></svg>`;

	const initials = (label) => {
		const w = String(label || "?").split(/[\s-]+/).filter(Boolean);
		return (w.length > 1 ? w[0][0] + w[1][0] : String(label || "?").slice(0, 2)).toUpperCase();
	};
	// workspace icons name a symbol in Frappe's inlined sprites; when sprites are present and the
	// symbol is not, show letters instead of an empty tile
	const has_icon = (name) => {
		if (!name) return false;
		if (!document.querySelector('symbol[id^="icon-"]')) return true;
		return !!document.getElementById(`icon-${name}`) || !!document.getElementById(name);
	};

	const glyph = (it, size = "md") => {
		if (it.image)
			return `<img src="${esc(it.image)}" alt="" onerror="this.outerHTML='<b>${esc(initials(it.label)).replace(/'/g, "")}</b>'">`;
		if (it.abbr) return `<b>${esc(it.abbr)}</b>`;
		if (is_emoji(it.icon)) return `<span class="dm-emoji">${esc(it.icon)}</span>`;
		const letters = `<b>${esc(initials(it.label))}</b>`;
		return has_icon(it.icon) ? icon(it.icon, size) || letters : letters;
	};
	const tile = (it, extra = "") =>
		`<span class="dm-tile ${extra}" style="--dm-c:${esc(color_of(it))}">${glyph(it)}</span>`;

	const link_icon = (l) => {
		if (l.icon) return is_emoji(l.icon) ? `<span class="dm-emoji">${esc(l.icon)}</span>` : icon(l.icon);
		return icon({ report: "file-chart-column", page: "app-window", dashboard: "layout-dashboard", url: "external-link", workspace: "layout-grid", group: "folder" }[l.link_type] || "list");
	};

	// ------------------------------------------------------------------ build
	const build = () => {
		$("body").addClass("dm-enabled").toggleClass("dm-no-panel", NO_PANEL);
		const c = S.cfg.settings;
		const lab = (t) => `<span class="dm-dock-label">${esc(t)}</span>`;
		const tool = (cls, ic, label, extra = "", text = label) =>
			`<button class="btn-reset dm-dock-btn ${cls}" data-tip="${esc(label)}" aria-label="${esc(label)}" ${extra}><span class="dm-dock-ic">${icon(ic, "md")}</span>${lab(text)}</button>`;
		$(`<div id="dm-shell"><nav id="dm-dock" aria-label="${__("Apps")}">
			${NO_PANEL ? `<button class="btn-reset dm-dock-btn dm-mini" aria-pressed="false" data-tip="${__("Minimize menu")} (Ctrl+B)" aria-label="${__("Minimize menu")}">
				<span class="dm-dock-ic dm-mini-ic"></span>${lab(__("Minimize"))}</button>` : ""}
			${NO_PANEL ? "" : `<a class="dm-dock-btn dm-home" href="${esc(c.home_route || "/desk")}" data-tip="${__("Home")}" aria-label="${__("Home")}"><span class="dm-dock-ic">${icon("house", "md")}</span>${lab(__("Home"))}</a>`}
			${c.show_search ? tool("dm-search", "search", __("Search") + " (Ctrl+K)", "", __("Search")) : ""}
			<button class="btn-reset dm-dock-btn dm-show" data-tip="${__("Show menu")} (Ctrl+B)" aria-label="${__("Show menu")}">${ICON_SHOW}</button>
			<div class="dm-dock-items" role="list"></div>
			<div class="dm-dock-tools">
				${c.show_full_width ? `<button class="btn-reset dm-dock-btn dm-width" data-tip="${__("Toggle Full Width")}" aria-label="${__("Toggle Full Width")}" aria-pressed="false"><span class="dm-dock-ic">${ICON_WIDTH}</span>${lab(__("Full width"))}</button>` : ""}
				${c.show_notifications ? `<div class="dropdown dropdown-notifications dm-notif">
					${tool("dm-bell", "bell", __("Notifications"), 'data-toggle="dropdown" aria-haspopup="true"')}
					<span class="dm-badge" hidden></span>
					<div class="dropdown-menu notifications-list" role="menu">
						<div class="notification-list-header"><div class="header-items"></div><div class="header-actions"></div></div>
						<div class="notification-list-body"><div class="panel-notifications"></div><div class="panel-events"></div><div class="panel-changelog-feed"></div></div>
					</div></div>` : ""}
				${c.show_todo ? `<a class="dm-dock-btn" href="/desk/todo" data-tip="${__("ToDo")}" aria-label="${__("ToDo")}"><span class="dm-dock-ic">${icon("list-todo", "md")}</span>${lab(__("To do"))}</a>` : ""}
			</div>
			<div class="dm-foot">
				<button class="btn-reset dm-user" aria-haspopup="true">
					${frappe.avatar(frappe.session.user, "avatar-small")}
					<span class="dm-user-text"><span class="dm-user-name">${esc(frappe.session.user_fullname || frappe.session.user)}</span>
					<span class="dm-user-mail">${esc(frappe.session.user_email || frappe.session.user)}</span></span>
					${icon("chevrons-up-down")}
				</button>
			</div>
		</nav>
		<aside id="dm-panel" aria-label="${__("Menu")}">
			<div class="dm-head">
				<button class="btn-reset dm-switch" aria-haspopup="true" aria-expanded="false"></button>
				${S.cfg.can_edit ? `<button class="btn-reset dm-edit" title="${__("Edit menu")}" aria-label="${__("Edit menu")}">${icon("pencil")}</button>` : ""}
				<button class="btn-reset dm-hide" title="${__("Hide menu")} (Ctrl+B)" aria-label="${__("Hide menu")}">${ICON_HIDE}</button>
				<div class="dm-switch-menu" role="menu"></div>
			</div>
			<div class="dm-find">
				<span class="dm-find-icon">${icon("search")}</span>
				<input type="search" class="dm-find-input" placeholder="${__("Search menu")}" aria-label="${__("Search menu")}" autocomplete="off" spellcheck="false">
				<button class="btn-reset dm-find-clear" aria-label="${__("Clear")}" hidden>${icon("x", "xs")}</button>
			</div>
			<nav class="dm-body"></nav>
		</aside></div>
		<div id="dm-more" role="dialog" aria-label="${__("All apps")}" hidden></div>
		<div id="dm-scrim"></div>
		<div id="dm-tip" role="tooltip" hidden></div>`).prependTo("body");

		set_collapsed(is_mobile() || store(KEY_COLLAPSED) === "1", false);
		if (NO_PANEL) set_mini(store(KEY_MINI) === "1", false);
		sync_width();
		render_dock();
		setup_notifications();
		setup_user_menu();
	};

	// ------------------------------------------------------------------ dock
	const render_dock = () => {
		const limit = Math.max(1, +S.cfg.settings.dock_limit || 10);
		// expanded dock: every workspace is listed (the list scrolls); icon rail: "More" after the limit
		const show = NO_PANEL || S.items.length <= limit + 1 ? S.items : S.items.slice(0, limit);
		const $items = $("#dm-dock .dm-dock-items").empty();
		show.forEach((it) =>
			$(`<a class="dm-dock-app" role="listitem" href="${esc(dock_href(it))}" data-key="${esc(it.key)}"
				data-tip="${esc(it.label)}" aria-label="${esc(it.label)}">${tile(it)}<span class="dm-dock-label">${esc(it.label)}</span></a>`).appendTo($items)
		);
		if (show.length < S.items.length)
			$(`<button class="btn-reset dm-dock-app dm-more-btn" data-tip="${__("More")}" aria-label="${__("More apps")}">
				<span class="dm-tile dm-tile-more">${icon("ellipsis", "md") || "•••"}</span><span class="dm-dock-label">${__("More")}</span></button>`).appendTo($items);

		$("#dm-more").html(
			`<div class="dm-more-title">${__("Apps")}</div><div class="dm-more-grid">${S.items
				.map((it) => `<a class="dm-more-app" href="${esc(dock_href(it))}" data-key="${esc(it.key)}">${tile(it)}<span>${esc(it.label)}</span></a>`)
				.join("")}</div>`
		);
		$("#dm-panel .dm-switch-menu").html(
			S.items
				.map((it) => `<a class="dm-switch-opt" role="menuitem" href="${esc(it.route || "#")}" data-key="${esc(it.key)}">${tile(it, "dm-tile-sm")}<span>${esc(it.label)}</span></a>`)
				.join("")
		);
		mark_active();
	};

	const mark_active = () => {
		$("[data-key]").removeClass("active");
		const p = path_now();
		if (NO_PANEL && (p === HOME || is_desk_home(p))) return $("#dm-dock .dm-more-btn").removeClass("active");
		if (S.active) $(`[data-key="${CSS.escape(S.active)}"]`).addClass("active");
		// keep the selected workspace visible in the scrolling list
		const $on = $(`#dm-dock .dm-dock-items [data-key="${CSS.escape(S.active || "")}"]`)[0];
		if ($on && $on.scrollIntoView) $on.scrollIntoView({ block: "nearest" });
		const hidden_active = S.active && !$(`#dm-dock .dm-dock-items [data-key="${CSS.escape(S.active)}"]`).length;
		$("#dm-dock .dm-more-btn").toggleClass("active", !!hidden_active);
	};

	// ------------------------------------------------------------------ menu
	const load_menu = (key) => {
		if (S.menus[key]) return Promise.resolve(S.menus[key]);
		return call("get_menu", { key }).then((m) => (S.menus[key] = m));
	};

	const select = (key, menu) => {
		if (!key) return Promise.resolve();
		S.active = key;
		store(KEY_ACTIVE, key);
		mark_active();
		if (menu) S.menus[key] = menu;
		return load_menu(key).then((m) => {
			if (S.active === key) render_menu(m);
			return m;
		});
	};

	const closed = () => {
		try {
			return JSON.parse(store(KEY_CLOSED) || "{}") || {};
		} catch (e) {
			return {};
		}
	};

	const open_nodes = () => {
		try {
			return JSON.parse(store(KEY_OPEN_NODES) || "{}") || {};
		} catch (e) {
			return {};
		}
	};

	// a link, and (v14 workspaces) its child links, collapsed unless opened or holding the current page
	// entries with `group` (v14 cards) have no page: clicking them opens / closes their links
	const link_tree = (l, flat, depth = 0, parent = "") => {
		flat.push(l);
		const i = flat.length - 1;
		if (l.lazy && !(l.children || []).length && S.sub[sub_key(l)]) l.children = S.sub[sub_key(l)];
		const kids = l.children || [];
		const lazy = !!l.lazy && !kids.length; // a sub-workspace: its menu is fetched when opened
		const a = l.group
			? `<a class="dm-link dm-group" href="#" role="button" data-i="${i}">
				<span class="dm-link-icon">${link_icon(l)}</span><span class="dm-link-label">${esc(l.label)}</span></a>`
			: `<a class="dm-link" href="${esc(l.route)}" data-i="${i}" ${l.new_tab ? 'target="_blank" rel="noopener"' : ""}>
				<span class="dm-link-icon">${link_icon(l)}</span><span class="dm-link-label">${esc(l.label)}</span></a>`;
		if (!kids.length && !lazy) return l.group ? "" : a;
		const id = l.route || `${parent}>${l.label}`;
		const st = open_nodes();
		const open = id in st ? !!st[id] : !!l.open;
		const body = kids.map((k) => link_tree(k, flat, depth + 1, id)).join("");
		const ws = l.ws ? `data-ws="${esc(l.ws)}" data-li="${i}" ${l.own ? 'data-own="1"' : ""}` : "";
		const edit = l.ws && S.cfg.can_edit
			? `<button class="btn-reset dm-node-edit" data-ws="${esc(l.ws)}" title="${__("Edit this menu")}" aria-label="${__("Edit this menu")}">${icon("pencil", "xs")}</button>` : "";
		return `<div class="dm-node ${open ? "is-open" : ""} ${lazy ? "dm-lazy" : ""}" data-node="${esc(id)}" ${ws}>
			<div class="dm-node-row">${a}${edit}<button class="btn-reset dm-node-toggle" aria-expanded="${open}" aria-label="${__("Show sub-pages")}">${icon("chevron-down", "xs")}</button></div>
			<div class="dm-node-kids">${body}</div></div>`;
	};

	const render_menu = (m) => {
		const it = S.items.find((x) => x.key === m.key) || { label: m.title };
		$("#dm-panel .dm-switch").html(
			`${tile(m.header_icon ? { ...it, icon: m.header_icon, abbr: "", image: "" } : it)}
			<span class="dm-switch-text"><span class="dm-switch-title">${esc(m.title)}</span>
			${S.cfg.subtitle ? `<span class="dm-switch-sub">${esc(S.cfg.subtitle)}</span>` : ""}</span>
			${S.items.length > 1 ? icon("chevron-down") : ""}`
		).prop("disabled", S.items.length < 2);
		const state = closed();
		const flat = [];
		const html = (m.blocks || [])
			.map((b, bi) => {
				if (b.type === "spacer") return `<div class="dm-spacer"></div>`;
				if (b.type === "link") return link_tree(b, flat);
				const id = `${m.key}::${b.label}`;
				const is_closed = b.collapsible && (id in state ? state[id] : !!b.keep_closed);
				const rows = b.items.map((l) => link_tree(l, flat)).join("");
				return `<section class="dm-sec ${is_closed ? "is-closed" : ""}" data-id="${esc(id)}">
					${b.label ? `<button class="btn-reset dm-sec-head" ${b.collapsible ? "" : "disabled"} aria-expanded="${!is_closed}">
						<span>${esc(b.label)}</span>${b.collapsible ? icon("chevron-down", "xs") : ""}</button>` : ""}
					<div class="dm-sec-body">${rows}</div></section>`;
			})
			.join("");
		S.flat = flat;
		$("#dm-panel .dm-body").html(html || `<div class="dm-empty">${__("Nothing in this menu yet.")}</div>`);
		highlight();
		load_open_nodes($("#dm-panel .dm-body"));
		filter_menu(); // keep the typed search when switching apps
	};

	const sub_key = (l) => l.ws + (l.own ? "|own" : "");

	// ------------------------------------------------------------------ menu editor (System Manager)
	const ENTRY_FIELDS = [
		{ fieldname: "entry_type", fieldtype: "Select", label: __("Type"), options: "Link\nSection\nSub-workspace\nSpacer", default: "Link", in_list_view: 1, columns: 1, reqd: 1 },
		{ fieldname: "label", fieldtype: "Data", label: __("Label"), in_list_view: 1, columns: 2 },
		{ fieldname: "link_type", fieldtype: "Select", label: __("Link Type"), options: "\nDocType\nReport\nPage\nDashboard\nURL\nWorkspace", in_list_view: 1, columns: 1 },
		{ fieldname: "link_to", fieldtype: "Data", label: __("Link To"), in_list_view: 1, columns: 2, description: __("Name of the DocType / Report / Page / Dashboard / Workspace") },
		{ fieldname: "workspace", fieldtype: "Link", options: "Workspace", label: __("Sub-workspace"), in_list_view: 1, columns: 1 },
		{ fieldname: "url", fieldtype: "Data", label: __("URL") },
		{ fieldname: "icon", fieldtype: "Data", label: __("Icon"), description: __("Lucide icon name, e.g. users, file-text") },
		{ fieldname: "in_section", fieldtype: "Check", label: __("In section"), default: 1, in_list_view: 1, columns: 1 },
		{ fieldname: "hidden", fieldtype: "Check", label: __("Hidden"), in_list_view: 1, columns: 1 },
		{ fieldname: "own_only", fieldtype: "Check", label: __("Own menu only"), description: __("Sub-workspace: its own links, without its sub-workspaces") },
		{ fieldname: "collapsed", fieldtype: "Check", label: __("Start collapsed"), description: __("Section") },
		{ fieldname: "new_tab", fieldtype: "Check", label: __("Open in new tab") },
	];
	const refresh_menus = () => {
		S.menus = {};
		S.sub = {};
		S.index = null;
		S.index_loading = null;
		S.located = {};
		if (S.active) select(S.active);
		$(document).trigger("dock_menu:changed"); // the Home page reloads its cards
	};
	const open_editor = (key) => {
		call("get_layout", { key }).then((r) => {
			const rows = (r.entries || []).map((e, i) => ({ ...e, idx: i + 1, name: `row-${i + 1}` }));
			const d = new frappe.ui.Dialog({
				title: __("Edit menu: {0}", [key.startsWith("ws:") ? key.slice(3) : r.menu_title || key]),
				size: "extra-large",
				fields: [
					{ fieldname: "menu_title", fieldtype: "Data", label: __("Menu title"), default: r.menu_title || "" },
					...(r.is_manager ? [{ fieldname: "for_all", fieldtype: "Check", label: __("Apply to everyone (shared menu)"), default: 0,
						description: __("Off: only your menu changes. On: the shared menu for all users who have not edited it themselves.") }] : []),
					{ fieldname: "help", fieldtype: "HTML", options: `<div class="text-muted small">${__(
						"Drag rows to reorder. A Section starts a collapsible group; rows below it with \"In section\" ticked belong to it. Sub-workspace rows expand into that workspace's menu. Users only see links they have permission to open."
					)}<br><b>${__("Changes apply only to you.")}</b>${r.mine ? ` ${__("You have edited this menu; Reset brings back the standard one.")}` : ""}</div>` },
					{ fieldname: "entries", fieldtype: "Table", label: __("Entries"), cannot_add_rows: false, in_place_edit: false, data: rows,
						get_data: () => rows, fields: ENTRY_FIELDS },
				],
				primary_action_label: __("Save"),
				primary_action: (v) => {
					const data = (d.fields_dict.entries.grid.get_data() || []).slice().sort((a, b) => (a.idx || 0) - (b.idx || 0));
					const entries = data.map((e) => {
						const o = {};
						ENTRY_FIELDS.forEach((f) => (o[f.fieldname] = e[f.fieldname]));
						return o;
					});
					frappe
						.xcall(API + "save_layout", { key, menu_title: v.menu_title || "", entries: JSON.stringify(entries), scope: v.for_all ? "all" : "user" })
						.then(() => {
							d.hide();
							frappe.show_alert({ message: __("Menu saved"), indicator: "green" });
							refresh_menus();
						});
				},
				secondary_action_label: r.mine ? __("Reset my changes") : r.shared && r.is_manager ? __("Reset shared menu") : null,
				secondary_action: r.mine || (r.shared && r.is_manager)
					? () =>
						frappe.confirm(r.mine ? __("Discard your changes to this menu?") : __("Discard the shared edits for everyone?"), () =>
							frappe.xcall(API + "reset_layout", { key, scope: r.mine ? "user" : "all" }).then(() => {
								d.hide();
								frappe.show_alert({ message: __("Menu reset"), indicator: "blue" });
								refresh_menus();
							})
						)
					: null,
			});
			d.show();
		});
	};

	// System Manager: why a sub-workspace shows what it shows (optionally for another user)
	const explain = (ws, user) =>
		frappe.xcall(API + "explain_submenu", { workspace: ws, user: user || null }).then((r) => {
			const yes = (v) => (v ? __("Yes") : `<b class="text-danger">${__("No")}</b>`);
			const facts = [
				[__("User"), esc(r.user)],
				[__("Parent workspace"), esc(r.parent || "—")],
				[__("User may open it"), yes(r.can_open) + (r.reason_hidden ? ` (${esc(r.reason_hidden)})` : "")],
				[__("Sub-workspaces"), esc((r.sub_workspaces || []).join(", ") || "—")],
				[__("Items come from"), esc(r.source || "—") + (r.workspace_sidebar ? ` + ${__("Workspace Sidebar")} ${esc(r.workspace_sidebar)}` : "")],
				[__("Edited menu"), r.edited_menu ? __("Yes") : __("No")],
				...(r.problem ? [[__("Problem"), `<b class="text-danger">${esc(r.problem)}</b>`]] : []),
			];
			const rows = (r.links || []).map((l) =>
				`<tr><td>${esc(l.origin)}</td><td>${esc(l.label || "")}</td><td>${esc(l.type || "")}</td><td>${esc(l.link_to || "")}</td>
				<td>${l.shown ? "✓" : `<span class="text-danger">${esc(l.why_not)}</span>`}</td></tr>`).join("");
			const d = new frappe.ui.Dialog({
				title: __("Menu of {0}", [ws]),
				size: "extra-large",
				fields: [
					{ fieldname: "user", fieldtype: "Link", options: "User", label: __("Check for user"), default: r.user,
						change() { const u = d.get_value("user"); if (u && u !== r.user) d.hide(), explain(ws, u); } },
					{ fieldname: "out", fieldtype: "HTML", options: `<table class="table table-sm">${facts.map(([k, v]) => `<tr><th style="width:30%">${k}</th><td>${v}</td></tr>`).join("")}</table>
						<table class="table table-sm table-bordered"><thead><tr><th>${__("From")}</th><th>${__("Label")}</th><th>${__("Type")}</th><th>${__("Link To")}</th><th>${__("Shown")}</th></tr></thead>
						<tbody>${rows || `<tr><td colspan="5" class="text-muted">${__("This workspace has no links: add shortcuts / cards to it, a Workspace Sidebar named like it, or edit this menu with the pencil.")}</td></tr>`}</tbody></table>` },
				],
			});
			d.show();
		});

	// ------------------------------------------------------------------ sub-workspaces (loaded on open)
	const load_open_nodes = ($in) => $in.find(".dm-node.dm-lazy.is-open").each((i, n) => void load_node(n));
	const load_node = (n) => {
		const $n = $(n);
		if (!$n.hasClass("dm-lazy")) return Promise.resolve();
		if ($n.data("loading")) return $n.data("loading");
		const ws = $n.attr("data-ws");
		const own = $n.attr("data-own") ? 1 : 0;
		const ck = ws + (own ? "|own" : "");
		const l = (S.flat || [])[+$n.attr("data-li")];
		const $kids = $n.children(".dm-node-kids").html(`<div class="dm-sub-note">${__("Loading...")}</div>`);
		const p = (S.sub[ck] ? Promise.resolve(S.sub[ck]) : call("get_submenu", { workspace: ws, own_only: own }).then((r) => (S.sub[ck] = r || [])))
			.then((kids) => {
				if (l) l.children = kids;
				const html = kids.map((k) => link_tree(k, S.flat, 1, $n.attr("data-node"))).join("");
				$n.removeClass("dm-lazy").removeData("loading");
				$kids.html(html || `<div class="dm-sub-note">${__("Nothing in this menu")}${S.cfg.is_manager
					? ` · <a href="#" class="dm-why" data-ws="${esc(ws)}">${__("Why?")}</a>` : ""}</div>`);
				load_open_nodes($kids);
				highlight();
				if ($("#dm-panel .dm-find-input").val()) filter_menu();
			})
			.catch(() => {
				$n.removeData("loading");
				$kids.html(`<div class="dm-sub-note">${__("Could not load this menu")}</div>`);
			});
		$n.data("loading", p);
		return p;
	};
	const open_node = ($n, open = true) => {
		$n.toggleClass("is-open", open);
		$n.children(".dm-node-row").find(".dm-node-toggle").attr("aria-expanded", String(open));
		const st = open_nodes();
		st[$n.data("node")] = open ? 1 : 0;
		store(KEY_OPEN_NODES, JSON.stringify(st));
		return open ? load_node($n[0]) : Promise.resolve();
	};
	// open the sub-workspaces leading to a page that is not loaded yet (from the search index)
	const reveal = (chain) =>
		(chain || []).reduce(
			(p, ws) => p.then(() => {
				const $n = $(`#dm-panel .dm-node[data-ws="${CSS.escape(ws)}"]`).first();
				return $n.length ? open_node($n) : null;
			}),
			Promise.resolve()
		).then(() => highlight());

	// ------------------------------------------------------------------ sidebar search
	// filters the links of the open menu; a matching section title keeps its whole section,
	// a matching sub-page keeps (and opens) its parent entries
	const norm = (t) => String(t || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
	const filter_menu = () => {
		const $body = $("#dm-panel .dm-body");
		const q = norm($("#dm-panel .dm-find-input").val());
		$("#dm-panel .dm-find-clear").prop("hidden", !q);
		$body.find(".dm-f-hide").removeClass("dm-f-hide");
		$body.find(".dm-f-open").removeClass("dm-f-open");
		$body.find(".dm-find-none, .dm-find-results").remove();
		$body.toggleClass("dm-filtering", !!q);
		if (!q) return;
		const words = q.split(" ");
		const hit = (text) => {
			const t = norm(text);
			return words.every((w) => t.includes(w));
		};
		$body.find(".dm-link").each(function () {
			$(this).toggleClass("dm-f-hide", !hit($(this).find(".dm-link-label").text()));
		});
		// sub-page trees, deepest first
		$($body.find(".dm-node").get().reverse()).each(function () {
			const $n = $(this);
			const $own = $n.children(".dm-node-row").find(".dm-link");
			// a matching card / workspace title keeps everything under it
			if (!$own.hasClass("dm-f-hide")) $n.children(".dm-node-kids").find(".dm-f-hide").removeClass("dm-f-hide");
			const kid_hit = $n.children(".dm-node-kids").find(".dm-link:not(.dm-f-hide)").length > 0;
			if (kid_hit) $own.removeClass("dm-f-hide"), $n.addClass("dm-f-open");
			$n.toggleClass("dm-f-hide", !kid_hit && $own.hasClass("dm-f-hide"));
		});
		$body.find(".dm-sec").each(function () {
			const $sec = $(this);
			if (hit($sec.find(".dm-sec-head span").first().text())) {
				$sec.find(".dm-f-hide").removeClass("dm-f-hide");
				$sec.addClass("dm-f-open");
				return;
			}
			const any = $sec.find(".dm-link:not(.dm-f-hide)").length > 0;
			$sec.toggleClass("dm-f-hide", !any).toggleClass("dm-f-open", any);
		});
		// every permitted menu (other apps, sub-workspaces not opened yet)
		load_index();
		const shown = new Set();
		$body.find(".dm-link:not(.dm-f-hide):not(.dm-group)").filter((i, el) => !$(el).parents(".dm-f-hide").length)
			.each(function () { shown.add($(this).attr("href")); });
		const hits = (S.index || [])
			.filter((r) => !shown.has(r.route) && hit([r.label, r.app, ...(r.trail || [])].join(" ")))
			.sort((a, b) => (hit(b.label) ? 1 : 0) - (hit(a.label) ? 1 : 0))
			.slice(0, 50);
		if (hits.length) {
			S.hits = hits;
			$body.append(`<div class="dm-find-results"><div class="dm-find-title">${__("All menus")}</div>${hits
				.map((r, i) => `<a class="dm-link dm-hit" href="${esc(r.route)}" data-hit="${i}" ${r.new_tab ? 'target="_blank" rel="noopener"' : ""}>
					<span class="dm-link-icon">${link_icon(r)}</span>
					<span class="dm-hit-text"><span class="dm-link-label">${esc(r.label)}</span>
					<span class="dm-hit-path">${esc([r.app, ...(r.trail || [])].filter(Boolean).join(" › "))}</span></span></a>`)
				.join("")}</div>`);
		}
		if (!visible_links().length)
			$body.append(`<div class="dm-empty dm-find-none">${S.index ? __("No matches") : __("Searching...")}</div>`);
	};
	const load_index = () => {
		if (S.index) return Promise.resolve(S.index);
		if (S.index_loading) return S.index_loading;
		S.index_loading = call("get_search_index")
			.then((r) => {
				S.index = r || [];
				if ($("#dm-panel .dm-find-input").val()) filter_menu();
			})
			.catch(() => (S.index = []))
			.then(() => S.index);
		return S.index_loading;
	};
	const open_hit = (r) => {
		clear_filter();
		const after = () => reveal(r.chain);
		if (r.key !== S.active) select(r.key).then(after);
		else after();
		go(r.route, route_options_of(r));
	};
	const visible_links = () =>
		$("#dm-panel .dm-body .dm-link:not(.dm-f-hide)").filter((i, el) => !$(el).parents(".dm-f-hide").length);
	const clear_filter = () => {
		$("#dm-panel .dm-find-input").val("");
		filter_menu();
	};

	const highlight = () => {
		const path = path_now();
		let best = null, score = 0;
		$("#dm-panel .dm-link").each(function () {
			const s = matches(path, (S.flat || [])[+$(this).data("i")]?.route);
			if (s > score) (best = this), (score = s);
		});
		$("#dm-panel .dm-link.active, #dm-panel .dm-link.is-last").removeClass("active is-last");
		if (best) {
			$(best).addClass("active").closest(".dm-sec.is-closed").removeClass("is-closed").find(".dm-sec-head").attr("aria-expanded", "true");
			$(best).parents(".dm-node").addClass("is-open").children(".dm-node-row").find(".dm-node-toggle").attr("aria-expanded", "true");
		} else if (S.index && S.revealed !== path) {
			S.revealed = path;
			let row = null, sc = 0;
			S.index.forEach((r) => {
				const m = r.key === S.active && r.chain && r.chain.length ? matches(path, r.route) : 0;
				if (m > sc) (row = r), (sc = m);
			});
			if (row) setTimeout(() => reveal(row.chain), 0);
		} else if (is_v14()) {
			// on a list / form / report: keep the workspace you came from marked, as v14 kept it selected
			const last = last_ws();
			if (last) $(`#dm-panel .dm-link[href="${CSS.escape(last.route)}"]`).first().addClass("is-last");
		}
		const home = (S.cfg.settings.home_route || "/desk").replace(/\/+$/, "");
		$("#dm-dock .dm-home").toggleClass("active", path === home || path === "/desk" || path === "/desk/desktop" || path === HOME);
		return !!best;
	};

	// ------------------------------------------------------------------ navigation
	const go = (route, opts) => {
		if (!route) return;
		if (is_v14()) register_pages();
		if (/^https?:/.test(route)) return window.open(route, "_blank", "noopener");
		if (opts) frappe.route_options = opts;
		frappe.set_route(route);
	};

	const route_options_of = (l) => {
		let opts = {};
		try {
			opts = typeof l.route_options === "string" ? JSON.parse(l.route_options || "{}") : l.route_options || {};
		} catch (e) {}
		try {
			const f = typeof l.filters === "string" ? JSON.parse(l.filters || "[]") : l.filters || [];
			(Array.isArray(f) ? f : []).forEach((x) => {
				if (Array.isArray(x) && x.length >= 4) opts[x[1]] = x[2] === "=" ? x[3] : [x[2], x[3]];
			});
		} catch (e) {}
		return Object.keys(opts).length ? opts : null;
	};

	const open_app = (key) => {
		close_popups();
		const it = S.items.find((x) => x.key === key);
		if (!it) return;
		if (is_v14()) register_pages();
		if (NO_PANEL && opens_page(it)) {
			select(key);
			return go(it.route);
		}
		if (NO_PANEL) {
			// the menu opens as a page: header + recently opened + this workspace's menu
			select(key);
			return frappe.set_route(ws_route(key));
		}
		if (is_mobile()) {
			// phones: a tap opens that app's menu over the page; the links navigate
			if (key === S.active && $("body").hasClass("dm-panel-open")) return set_collapsed(true, false);
			set_collapsed(false, false);
			return select(key);
		}
		if (key === S.active) return set_collapsed(!$("body").hasClass("dm-collapsed"));
		set_collapsed(false);
		select(key).then((m) => {
			const mode = S.cfg.settings.click_opens;
			if (mode === "Menu only") return;
			const known = it.workspace && frappe.workspaces && frappe.workspaces[frappe.router.slug(it.workspace)];
			const first = (S.flat || []).find((l) => !l.new_tab);
			if (mode === "Workspace page" && it.route && (known || !first)) return go(it.route);
			if (first) go(first.route, route_options_of(first));
			else if (it.route) go(it.route);
		});
	};

	// ------------------------------------------------------------------ v14 behaviour
	const is_v14 = () => S.cfg && S.cfg.style === "v14";
	const landing_list = () => (S.cfg && S.cfg.landing) || [];
	const last_ws = () => {
		const name = store(KEY_LAST_WS);
		return landing_list().find((p) => p.name === name) || null;
	};
	// the desk opens the last used workspace (v14: last visited), else the first one the user may open
	const home_page_mode = () => !!S.cfg && S.cfg.settings.landing_page !== "Last used workspace";
	// no Home page: the desk opens straight onto a workspace's menu (the last one used, else the first)
	const landing_item = () => S.items.find((x) => x.key === (S.active || store(KEY_ACTIVE))) || S.items[0];
	const landing_route = () => {
		if (NO_PANEL) return landing_item() ? ws_route(landing_item().key) : null;
		if (home_page_mode()) return HOME;
		if (is_v14()) return (last_ws() || landing_list()[0] || {}).route || null;
		const it = S.items.find((x) => x.key === S.active) || S.items[0];
		if (!it) return null;
		const known = it.workspace && frappe.workspaces && frappe.workspaces[frappe.router.slug(it.workspace)];
		if (it.route && (known || !it.sidebar)) return it.route;
		const first = ((S.menus[it.key] || {}).blocks || []).flatMap((b) => (b.type === "section" ? b.items : b.type === "link" ? [b] : []))
			.find((l) => !l.new_tab && String(l.route || "").startsWith("/desk/"));
		return (first && first.route) || it.route || null;
	};
	// v14 lists workspaces v16 did not boot; tell the router about them so their routes open
	// (v16 rebuilds frappe.workspaces when it draws a workspace, so this runs before each navigation)
	const register_pages = () => {
		const pages = (S.cfg && S.cfg.register) || (frappe.boot && frappe.boot.dock_menu && frappe.boot.dock_menu.register) || [];
		if (!pages.length) return;
		frappe.workspaces = frappe.workspaces || {};
		frappe.boot.allowed_workspaces = frappe.boot.allowed_workspaces || [];
		pages.forEach((p) => {
			const page = { ...p, label: p.name };
			const keys = [frappe.router.slug(p.name)];
			if (!p.public && p.title) keys.push(frappe.router.slug(p.title));
			keys.forEach((key) => {
				if (!frappe.workspaces[key]) frappe.workspaces[key] = page;
			});
			if (!frappe.boot.allowed_workspaces.some((x) => x.name === p.name)) frappe.boot.allowed_workspaces.push(page);
		});
	};
	const DESK_HOMES = ["/desk", "/app", "/desk/desktop", "/desk/workspaces", "/desk/home", "/app/home"];
	const is_desk_home = (path) => DESK_HOMES.includes(path);
	const home_is_default = () => ["", "/desk", "/app"].includes((S.cfg.settings.home_route || "/desk").replace(/\/+$/, ""));
	// open the workspace menu instead of the v16 apps grid (after login and from the Home icon)
	const use_landing = () => !!S.cfg && S.cfg.settings.open_workspace_on_desk !== 0 && home_is_default();
	const to_landing = (path) => {
		// /desk already draws the Home page (boot home_page)
		if (!NO_PANEL && home_page_mode() && frappe.boot && frappe.boot.home_page === "dock-home" && (path === "/desk" || path === "/app")) return false;
		const r = landing_route();
		if (!r || r.replace(/\/+$/, "") === path) return false;
		if (!is_mobile()) set_collapsed(false, false); // show the menu of that workspace
		(frappe.route_flags = frappe.route_flags || {}).replace_route = true;
		go(r);
		return true;
	};
	// hide the apps grid until we know where to go, so it does not flash after login
	const end_boot = () => $("body").removeClass("dm-landing");

	// pages opened recently (Home page), per browser
	const recent = () => {
		try {
			return JSON.parse(store(KEY_RECENT) || "[]") || [];
		} catch (e) {
			return [];
		}
	};
	const remember = (path) => {
		if (!path.startsWith("/desk/") || path === HOME || path.startsWith(HOME + "/") || is_desk_home(path)) return;
		setTimeout(() => {
			if (path_now() !== path) return;
			const l = (S.flat || []).find((x) => x.route && x.route.replace(/\/+$/, "") === path);
			const r = (S.index || []).find((x) => x.route.replace(/\/+$/, "") === path);
			const label = (l && l.label) || (r && r.label) || String(document.title || "").replace(/\s*[|·-]\s*[^|·-]*$/, "").trim() || path;
			const it = S.items.find((x) => x.key === S.active);
			const row = { route: path, label, icon: (l && l.icon) || (r && r.icon) || "", path: [it && it.label, ...((r && r.trail) || [])].filter(Boolean).join(" › ") };
			store(KEY_RECENT, JSON.stringify([row, ...recent().filter((x) => x.route !== path)].slice(0, 12)));
		}, 900);
	};

	const on_route = () => {
		if (!S.cfg) return;
		remember(path_now());
		close_popups();
		if (is_mobile()) set_collapsed(true, false);
		const path = path_now();
		if (is_v14()) register_pages();
		if ((is_desk_home(path) || (NO_PANEL && path === HOME)) && (NO_PANEL || use_landing()) && to_landing(path)) return;
		end_boot();
		if (is_v14()) {
			const page = landing_list().find((p) => path === p.route.replace(/\/+$/, ""));
			if (page) store(KEY_LAST_WS, page.name);
		}
		if (path.startsWith(HOME + "/")) {
			const k = key_of_path(path);
			if (k && k !== S.active) select(k);
			else mark_active();
			highlight();
			return;
		}
		if (path === HOME) mark_active();
		const ws = S.items.find((x) => x.route && path === x.route.replace(/\/+$/, ""));
		if (ws && ws.key !== S.active) return select(ws.key);
		if (highlight() || !path.startsWith("/desk/") || path === "/desk" || path === HOME) return;
		// a page outside this menu (search, a link in a form…): switch to the menu that has it
		const p = path in S.located ? Promise.resolve(S.located[path]) : call("locate", { path }).then((k) => (S.located[path] = k));
		p.then((k) => {
			if (k && k !== S.active && path_now() === path) select(k);
		});
	};

	// ------------------------------------------------------------------ panel state
	// below 992px the menu slides over the page (see CSS) and opens on demand
	const is_mobile = () => window.innerWidth < 992;
	const set_collapsed = (c, remember = true) => {
		if (NO_PANEL) c = true;
		$("body").toggleClass("dm-collapsed", c).toggleClass("dm-panel-open", !c && is_mobile());
		if (remember && !is_mobile()) store(KEY_COLLAPSED, c ? "1" : "0");
	};
	// expanded dock <-> icon rail
	const set_mini = (on, remember = true) => {
		$("body").toggleClass("dm-dock-mini", on);
		$("#dm-dock .dm-mini").attr({ "aria-pressed": String(on), "aria-label": on ? __("Expand menu") : __("Minimize menu"),
			"data-tip": (on ? __("Expand menu") : __("Minimize menu")) + " (Ctrl+B)" })
			.find(".dm-mini-ic").html(on ? ICON_SHOW : ICON_HIDE);
		if (remember) store(KEY_MINI, on ? "1" : "0");
		$("#dm-tip").prop("hidden", true);
		setTimeout(() => $(window).trigger("resize"), 200); // let charts / grids re-measure
	};
	const close_popups = () => {
		$("#dm-more").prop("hidden", true);
		$("#dm-panel").removeClass("dm-switch-open").find(".dm-switch").attr("aria-expanded", "false");
	};

	// ------------------------------------------------------------------ full width
	const is_full_width = () => {
		try {
			return JSON.parse(store("container_fullwidth") || "false") === true;
		} catch (e) {
			return false;
		}
	};
	const sync_width = () => {
		const on = is_full_width();
		$("body").toggleClass("full-width", on);
		$("#dm-dock .dm-width").toggleClass("active", on).attr("aria-pressed", String(on));
	};
	const toggle_width = () => {
		// same switch (and localStorage key) as Frappe's "Toggle Full Width" in the user menu
		if (frappe.ui.toolbar && frappe.ui.toolbar.toggle_full_width) frappe.ui.toolbar.toggle_full_width();
		else {
			store("container_fullwidth", String(!is_full_width()));
			$(document.body).trigger("toggleFullWidth");
		}
		sync_width();
		$(window).trigger("resize"); // let charts / grids re-measure
	};

	// ------------------------------------------------------------------ search / notifications / user
	let own_awesomebar = null;
	const open_search = () => {
		const $default = $("#navbar-modal-search");
		if ($default.length) return $default.first().trigger("click");
		if (!own_awesomebar && frappe.search && frappe.search.AwesomeBar) {
			$(`<button id="dm-search-trigger" class="btn-reset" hidden></button>`).appendTo("body");
			own_awesomebar = new frappe.search.AwesomeBar();
			own_awesomebar.setup("#dm-search-trigger");
		}
		if (own_awesomebar) return $("#dm-search-trigger").trigger("click");
		frappe.searchdialog && frappe.searchdialog.search && frappe.searchdialog.search.init_search("", "global_search");
	};

	const refresh_badge = () => {
		if (!S.cfg.settings.show_notifications) return;
		frappe
			.xcall("frappe.client.get_count", { doctype: "Notification Log", filters: { for_user: frappe.session.user, read: 0 } })
			.then((n) => $("#dm-dock .dm-badge").text(n > 99 ? "99+" : n).prop("hidden", !n))
			.catch(() => {});
	};

	const setup_notifications = () => {
		const $w = $("#dm-dock .dm-notif");
		if (!$w.length) return;
		try {
			if (frappe.ui.Notifications) new frappe.ui.Notifications({ wrapper: $w, full_height: false });
		} catch (e) {
			console.error(e);
		}
		refresh_badge();
		$w.on("hidden.bs.dropdown", refresh_badge);
		frappe.realtime && frappe.realtime.on && frappe.realtime.on("notification", () => setTimeout(refresh_badge, 300));
	};

	const user_menu_items = () => [
		{ icon: "user", label: __("My Settings"), url: `/desk/user/${encodeURIComponent(frappe.session.user)}` },
		{ icon: "sun-moon", label: __("Toggle Theme"), action: () => new frappe.ui.ThemeSwitcher().show() },
		{ icon: "move-horizontal", label: __("Toggle Full Width"), action: toggle_width },
		...(S.cfg.is_manager ? [{ icon: "settings", label: __("Dock Menu Settings"), url: "/desk/dock-menu-settings" },
			{ icon: "layout-grid", label: __("Dock Menu Items"), url: "/desk/dock-menu-item" },
			{ icon: "pencil", label: __("Edited Menus"), url: "/desk/dock-menu-layout" }] : []),
		{ icon: "info", label: __("About"), action: () => frappe.ui.toolbar.show_about() },
		{ icon: "log-out", label: __("Log out"), action: () => frappe.app.logout() },
	];

	const setup_user_menu = () => {
		const $btn = $("#dm-dock .dm-user");
		const $menu = $(`<div class="dm-user-menu" role="menu" hidden></div>`).insertBefore($btn);
		user_menu_items().forEach((it) => {
			const $a = $(`<a class="dm-user-opt" role="menuitem" href="${esc(it.url || "#")}">${icon(it.icon)}<span>${esc(it.label)}</span></a>`);
			$a.on("click", (e) => {
				$menu.prop("hidden", true);
				if (it.url) return;
				e.preventDefault();
				it.action();
			});
			$menu.append($a);
		});
		$btn.on("click", (e) => {
			e.stopPropagation();
			$menu.prop("hidden", !$menu.prop("hidden"));
		});
		$(document).on("click", (e) => {
			if (!$(e.target).closest(".dm-user-menu, .dm-user").length) $menu.prop("hidden", true);
		});
	};

	// ------------------------------------------------------------------ events
	const bind = () => {
		$(document)
			.on("click", "#dm-dock .dm-dock-app[data-key], #dm-more .dm-more-app, #dm-panel .dm-switch-opt", function (e) {
				if (e.ctrlKey || e.metaKey) return;
				e.preventDefault();
				open_app($(this).data("key"));
			})
			.on("click", "#dm-dock .dm-more-btn", (e) => {
				e.stopPropagation();
				const $m = $("#dm-more");
				const open = $m.prop("hidden");
				close_popups();
				$m.prop("hidden", !open);
			})
			.on("click", "#dm-dock .dm-home", function (e) {
				if (e.ctrlKey || e.metaKey) return;
				let href = $(this).attr("href");
				if (!href.startsWith("/desk")) return;
				e.preventDefault();
				close_popups();
				if (use_landing()) {
					if (to_landing(path_now())) return;
					href = landing_route() || href;
				}
				if (is_v14()) register_pages();
				frappe.set_route(href);
			})
			.on("click", "#dm-dock .dm-search", () => open_search())
			.on("click", "#dm-dock .dm-width", () => toggle_width())
			.on("click", "#dm-panel .dm-edit", (e) => {
				e.preventDefault();
				if (S.active) open_editor(S.active);
			})
			.on("click", "#dm-panel .dm-why", function (e) {
				e.preventDefault();
				explain($(this).data("ws"));
			})
			.on("click", "#dm-panel .dm-node-edit", function (e) {
				e.preventDefault();
				e.stopPropagation();
				open_editor("ws:" + $(this).data("ws"));
			})
			.on("input", "#dm-panel .dm-find-input", () => filter_menu())
			.on("focus", "#dm-panel .dm-find-input", () => load_index())
			.on("click", "#dm-panel .dm-hit", function (e) {
				const r = (S.hits || [])[+$(this).data("hit")];
				if (!r || $(this).attr("target") === "_blank" || e.ctrlKey || e.metaKey) return;
				e.preventDefault();
				open_hit(r);
			})
			.on("keydown", "#dm-panel .dm-find-input", function (e) {
				if (e.key === "Escape") {
					e.stopPropagation();
					if ($(this).val()) clear_filter();
					else $(this).blur();
				} else if (e.key === "Enter") {
					e.preventDefault();
					visible_links().first().trigger("click"); // open the first match
				} else if (e.key === "ArrowDown") {
					e.preventDefault();
					visible_links().first().trigger("focus");
				}
			})
			.on("keydown", "#dm-panel .dm-body .dm-link", function (e) {
				if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
				e.preventDefault();
				const $all = visible_links();
				const i = $all.index(this) + (e.key === "ArrowDown" ? 1 : -1);
				if (i < 0) $("#dm-panel .dm-find-input").trigger("focus");
				else $all.eq(Math.min(i, $all.length - 1)).trigger("focus");
			})
			.on("click", "#dm-panel .dm-find-clear", () => {
				clear_filter();
				$("#dm-panel .dm-find-input").trigger("focus");
			})
			.on("click", "#dm-panel .dm-switch", (e) => {
				e.stopPropagation();
				const open = !$("#dm-panel").hasClass("dm-switch-open");
				close_popups();
				$("#dm-panel").toggleClass("dm-switch-open", open).find(".dm-switch").attr("aria-expanded", String(open));
			})
			.on("click", "#dm-panel .dm-sec-head", function () {
				const $sec = $(this).closest(".dm-sec");
				const c = !$sec.hasClass("is-closed");
				$sec.toggleClass("is-closed", c);
				$(this).attr("aria-expanded", String(!c));
				const state = closed();
				state[$sec.data("id")] = c;
				store(KEY_CLOSED, JSON.stringify(state));
			})
			.on("click", "#dm-panel .dm-node-toggle, #dm-panel .dm-group", function (e) {
				e.preventDefault();
				const $n = $(this).closest(".dm-node");
				open_node($n, !$n.hasClass("is-open"));
			})
			.on("click", "#dm-panel .dm-link", function (e) {
				if ($(this).hasClass("dm-group")) return e.preventDefault();
				if ($(this).hasClass("dm-hit")) return;
				const $node = $(this).parent(".dm-node-row").parent(".dm-node");
				if ($node.length && !$node.hasClass("is-open") && !e.ctrlKey && !e.metaKey) open_node($node);
				if ($(this).attr("target") === "_blank" || e.ctrlKey || e.metaKey) return;
				e.preventDefault();
				const l = (S.flat || [])[+$(this).data("i")];
				if (l) go(l.route, route_options_of(l));
				if ($("#dm-panel .dm-find-input").val()) clear_filter();
			})
			.on("mouseenter focusin", "#dm-dock [data-tip]", function () {
				const r = this.getBoundingClientRect();
				$("#dm-tip").text($(this).attr("data-tip")).css({ left: r.right + 10, top: r.top + r.height / 2 }).prop("hidden", false);
			})
			.on("mouseleave focusout click", "#dm-dock [data-tip]", () => $("#dm-tip").prop("hidden", true))
			.on("click", "#dm-panel .dm-hide", () => set_collapsed(true, !is_mobile()))
			.on("click", "#dm-dock .dm-show", () => set_collapsed(false, !is_mobile()))
			.on("click", "#dm-dock .dm-mini", () => set_mini(!$("body").hasClass("dm-dock-mini")))
			.on("click", "#dm-scrim", () => set_collapsed(true, false))
			.on("click", (e) => {
				if (!$(e.target).closest("#dm-more, .dm-more-btn, .dm-switch, .dm-switch-menu").length) close_popups();
			})
			.on("keydown", (e) => {
				if (e.key === "Escape") close_popups();
				if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "m" && !$(e.target).is("input, textarea, [contenteditable]")) {
					e.preventDefault(); // Alt+M: search the sidebar menu
					set_collapsed(false, !is_mobile());
					$("#dm-panel .dm-find-input").trigger("focus").trigger("select");
				}
				if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "b" && !$(e.target).is("input, textarea, [contenteditable]")) {
					e.preventDefault();
					if (NO_PANEL) set_mini(!$("body").hasClass("dm-dock-mini"));
					else set_collapsed(!$("body").hasClass("dm-collapsed"));
				}
			});
		frappe.router.on("change", on_route);
		// crossing the 992px line: overlay menus start hidden, docked ones restore the saved state
		let was_mobile = is_mobile();
		$(window).on("resize", frappe.utils.debounce ? frappe.utils.debounce(on_resize, 150) : on_resize);
		function on_resize() {
			const m = is_mobile();
			if (m !== was_mobile) set_collapsed(m || store(KEY_COLLAPSED) === "1", false);
			was_mobile = m;
		}
	};

	// ------------------------------------------------------------------ start
	const start = () => {
		call("get_dock", { path: path_now(), key: store(KEY_ACTIVE) })
			.then((r) => {
				if (!r || !r.enabled) return ready_done(null), end_boot();
				S.cfg = r;
				S.items = r.items || [];
				build();
				bind();
				ready_done(S);
				if (!r.active) return end_boot();
				select(r.active, r.menu)
					.then(() => {
						if (!is_v14()) return on_route();
						register_pages();
						// a reload straight onto a page v16 did not boot: parse the address again now it is known
						const path = path_now();
						const known = landing_list().some((p) => path === p.route.replace(/\/+$/, ""));
						if (known && ((frappe.get_route && frappe.get_route()) || [])[0] !== "Workspaces" && frappe.router.route) return frappe.router.route();
						on_route();
					})
					.catch(end_boot)
					.finally(() => setTimeout(load_index, 1500)); // search + opening sub-workspaces for the current page
			})
			.catch((e) => {
				ready_done(null);
				end_boot();
				console.error("dock_menu", e);
			});
	};

	window.dock_menu = {
		ready: READY,
		no_panel: NO_PANEL,
		items: () => S.items,
		item_of_path: (p) => S.items.find((x) => x.key === key_of_path(p)) || null,
		ws_route,
		color: (it) => color_of(it),
		menu: (key) => load_menu(key),
		submenu: (ws, own) => {
			const ck = ws + (own ? "|own" : "");
			return S.sub[ck] ? Promise.resolve(S.sub[ck]) : call("get_submenu", { workspace: ws, own_only: own ? 1 : 0 }).then((r) => (S.sub[ck] = r || []));
		},
		route_options: (l) => route_options_of(l),
		can_edit: () => !!(S.cfg && S.cfg.can_edit),
		is_manager: () => !!(S.cfg && S.cfg.is_manager),
		explain: (ws) => explain(ws),
		refresh: () => ((S.menus = {}), S.active && select(S.active)),
		open_app,
		open_editor: (key) => open_editor(key),
		reload: () => refresh_menus(),
		tile: (it) => tile(it),
		recent,
		index: () => S.index,
		load_index: () => load_index() || Promise.resolve(S.index),
		open_hit: (r) => open_hit(r),
		// Home page: open a link of a dock icon's menu (its menu goes into the sidebar)
		go_to: (key, route, opts) => {
			if (key && key !== S.active && S.items.some((x) => x.key === key)) select(key);
			go(route, opts);
		},
		open_sub: (key, sub) => {
			const after = () => sub.ws && reveal([sub.ws]);
			if (key && key !== S.active) select(key).then(after);
			else after();
			if (!is_mobile()) set_collapsed(false);
			if (sub.route) go(sub.route);
		},
	};
	// Never draw the v16 apps page: when the router is about to open it (after login, Home, logo, /desk),
	// switch the address to the landing workspace first (data from boot, see api.extend_bootinfo)
	const boot_landing = () => {
		const b = frappe.boot && frappe.boot.dock_menu;
		if (!b || !b.enabled || !(b.landing || []).length) return null;
		const last = b.style === "v14" ? store(KEY_LAST_WS) : store(KEY_ACTIVE);
		return ((b.landing.find((p) => p.name === last) || b.landing[0]) || {}).route || null;
	};
	const wrap_router = () => {
		if (!frappe.router || typeof frappe.router.route !== "function" || frappe.router._dm_wrapped) return;
		const orig = frappe.router.route;
		frappe.router.route = function (...args) {
			try {
				const p = decodeURIComponent(window.location.pathname).replace(/\/+$/, "");
				const native_home = frappe.boot && frappe.boot.home_page === "dock-home" && (p === "/desk" || p === "/app");
				if (DESK_HOMES.includes(p) && !native_home) {
					const r = boot_landing();
					if (r && r.replace(/\/+$/, "") !== p) {
						register_pages();
						window.history.replaceState(window.history.state, "", r);
					}
				}
			} catch (e) {
				console.error("dock_menu", e);
			}
			return orig.apply(this, args);
		};
		frappe.router._dm_wrapped = true;
	};
	wrap_router();
	$(document).on("startup", wrap_router); // in case the router was created after this file

	// opening the desk on the apps page (e.g. right after login): keep it hidden until redirected
	try {
		const p = window.location.pathname.replace(/\/+$/, "");
		if (["/desk", "/app", "/desk/desktop", "/desk/home", "/app/home"].includes(p)) {
			$(() => $("body").addClass("dm-landing"));
			setTimeout(() => $("body").removeClass("dm-landing"), 4000); // never stay blank
		}
	} catch (e) {}
	$(document).on("startup", start);
})();
