"""Dock Menu: an icon dock (one icon per workspace the user's roles allow) and a
sectioned sidebar for the selected icon.

Dock icons
    • "Dock Menu Item" records (label, workspace / Workspace Sidebar, icon, colour, roles), or
    • when there are none: every top-level workspace the user may open (own private ones too).
    An icon is shown only if its Roles table is empty or shares a role with the user, and
    its workspace (if any) is one Frappe lets the user open.

Sidebar of an icon
    • the v16 "Workspace Sidebar" (explicit, or the one titled like the workspace):
      Section Breaks become collapsible sections, links keep their order and icons; or
    • the workspace itself: shortcuts on top, Link Cards as sections.
    Every link is checked against DocType read / Report / Page permissions.
"""

import json
import os

import frappe
from frappe import _

SETTINGS = "Dock Menu Settings"
ITEM = "Dock Menu Item"
MANAGER = "System Manager"
LINK_TYPES = ("doctype", "report", "page", "url", "dashboard", "workspace")
DOC_VIEW_PATH = {
	"New": "new",
	"Report Builder": "view/report",
	"Tree": "view/tree",
	"Calendar": "view/calendar/default",
	"Dashboard": "view/dashboard",
	"Image": "view/image",
	"Kanban": "view/kanban",
}
V14 = "Workspaces (v14)"
APP_MODULE = "Dock Menu"  # workspaces shipped with this app (Operations) are shown by their links, not the module
DEFAULTS = {
	"enabled": 1,
	"menu_style": V14,
	"apply_to_system_managers": 1,
	"open_workspace_on_desk": 1,
	"edit_access": "All users",
	"landing_page": "Home page",
	"home_route": "/desk",
	"subtitle": "Company Abbreviation",
	"dock_limit": 10,
	"click_opens": "Workspace page",
	"show_search": 1,
	"show_full_width": 1,
	"show_notifications": 1,
	"show_todo": 1,
}


# ----------------------------------------------------------------------------- helpers


def _slug(name: str) -> str:
	# same as frappe.router.slug
	return (name or "").lower().replace(" ", "-")


def _local_cache(name: str) -> dict:
	"""Per-request dict on frappe.local (a werkzeug Local: no __dict__ / setdefault)."""
	cache = getattr(frappe.local, name, None)
	if cache is None:
		cache = {}
		setattr(frappe.local, name, cache)
	return cache


def _table_ready(doctype) -> bool:
	cache = _local_cache("dock_menu_tables")
	if doctype not in cache:
		try:
			cache[doctype] = bool(frappe.db.table_exists(doctype))
		except Exception:
			cache[doctype] = False
	return cache[doctype]


def _settings() -> dict:
	cache = _local_cache("dock_menu_settings")
	if not cache:
		cache.update(_read_settings())
	return cache


def _read_settings() -> dict:
	out = dict(DEFAULTS)
	if not frappe.db.exists("DocType", SETTINGS):
		return out
	# a Single that was never saved reads its checks as 0: keep the defaults then
	if not frappe.db.sql("select 1 from `tabSingles` where doctype=%s limit 1", SETTINGS):
		return out
	try:
		doc = frappe.get_cached_doc(SETTINGS)
	except Exception:
		return out
	for k in DEFAULTS:
		v = doc.get(k)
		if v is not None and v != "":
			out[k] = v
	return out


def _enabled(settings) -> bool:
	if frappe.session.user == "Guest" or not settings.get("enabled"):
		return False
	if frappe.db.get_value("User", frappe.session.user, "user_type") != "System User":
		return False
	if MANAGER in frappe.get_roles() and not settings.get("apply_to_system_managers"):
		return False
	return True


def _subtitle(settings) -> str:
	mode = settings.get("subtitle")
	if mode == "None" or not frappe.db.exists("DocType", "Company"):
		return ""
	company = frappe.defaults.get_user_default("Company") or frappe.defaults.get_global_default("company")
	if not company:
		return ""
	if mode == "Company":
		return company
	return frappe.db.get_value("Company", company, "abbr") or company


def _initials(label: str) -> str:
	words = [w for w in (label or "").replace("-", " ").split() if w[:1].isalnum()]
	if len(words) >= 2:
		return (words[0][0] + words[1][0]).upper()
	return (label or "?")[:2].title()


# ----------------------------------------------------------------------------- permissions


def _can(link_type, link_to) -> bool:
	"""Permission check for the logged-in user (cached per request)."""
	cache = _local_cache("dock_menu_can")
	key = (link_type, link_to)
	if key in cache:
		return cache[key]
	ok = False
	try:
		if link_type == "url":
			ok = True
		elif link_type == "doctype":
			ok = bool(frappe.db.exists("DocType", link_to)) and bool(frappe.has_permission(link_to, "read"))
		elif link_type == "report":
			ok = bool(frappe.db.exists("Report", link_to)) and frappe.get_cached_doc("Report", link_to).is_permitted()
		elif link_type == "page":
			ok = bool(frappe.db.exists("Page", link_to)) and frappe.get_cached_doc("Page", link_to).is_permitted()
		elif link_type == "dashboard":
			ok = bool(frappe.db.exists("Dashboard", link_to))
		elif link_type == "workspace":
			ok = link_to in _allowed_workspaces()
	except Exception:
		ok = False
	cache[key] = bool(ok)
	return cache[key]


def _allowed_workspaces() -> dict:
	"""{name: row} of top-level workspaces the user may open (Frappe's own check + roles)."""
	if hasattr(frappe.local, "dock_menu_ws"):
		return frappe.local.dock_menu_ws

	meta = frappe.get_meta("Workspace")
	wanted = ["title", "label", "icon", "public", "for_user", "parent_page", "is_hidden", "module", "sequence_id"]
	fields = ["name"] + [f for f in wanted if meta.has_field(f)]
	order = "sequence_id asc, name asc" if meta.has_field("sequence_id") else "name asc"
	rows = frappe.get_all("Workspace", fields=fields, order_by=order)

	ws_roles = {}
	for r in frappe.get_all("Has Role", filters={"parenttype": "Workspace"}, fields=["parent", "role"]):
		ws_roles.setdefault(r.parent, set()).add(r.role)
	user, roles = frappe.session.user, set(frappe.get_roles())
	try:
		blocked = set(frappe.get_cached_doc("User", user).get_blocked_modules() or [])
	except Exception:
		blocked = set()

	frappe_allowed = _frappe_allowed_workspaces()
	out = {}
	for w in rows:
		if w.get("is_hidden"):
			continue
		if not w.get("public") and w.get("for_user") != user:
			continue
		own_app = w.get("module") == APP_MODULE
		if w.get("public"):
			need = ws_roles.get(w.name)
			if need and not (need & roles):
				continue
			if w.get("module") and w.module in blocked and not own_app:
				continue
		if own_app:
			# shipped with this app (Operations): not tied to the "Dock Menu" module's permissions,
			# shown to anyone who can open at least one of its links
			if not _opens_something(w.name):
				continue
		elif frappe_allowed is not None and w.name not in frappe_allowed:
			continue
		w["title"] = w.get("title") or w.get("label") or w.name
		w["public"] = int(bool(w.get("public")))
		out[w.name] = w
	frappe.local.dock_menu_ws = out
	return out


def _opens_something(workspace) -> bool:
	try:
		doc = frappe.get_cached_doc("Workspace", workspace)
	except Exception:
		return False
	for s in doc.get("shortcuts") or []:
		if _can((s.get("type") or "").lower(), s.get("link_to")):
			return True
	for l in doc.get("links") or []:
		if l.get("type") != "Card Break" and _can((l.get("link_type") or "").lower(), l.get("link_to")):
			return True
	return False


def _frappe_allowed_workspaces():
	try:
		from frappe.desk.desktop import get_workspaces

		pages = (get_workspaces() or {}).get("pages")
		if pages is not None:
			return {p.get("name") for p in pages}
	except Exception:
		pass
	try:
		from frappe.desk.desktop import get_workspace_sidebar_items

		return {p.get("name") for p in (get_workspace_sidebar_items() or {}).get("pages", [])}
	except Exception:
		return None


def _ws_route(ws) -> str:
	if not ws.get("public"):
		# by full name ("<title>-<user>"): every v16 router resolves it (newer ones also accept the
		# title and rewrite the address to it; the client treats that spelling as an alias)
		return f"/desk/private/{_slug(ws['name'])}"
	return f"/desk/{_slug(ws['name'])}"


# ----------------------------------------------------------------------------- dock


def _is_v14() -> bool:
	return _settings().get("menu_style") == V14


def _dock_items() -> list[dict]:
	if _is_v14():
		return _v14_dock_items()
	allowed = _allowed_workspaces()
	user_roles = set(frappe.get_roles())
	items = []

	configured = []
	if _table_ready(ITEM):
		configured = frappe.get_all(
			ITEM,
			filters={"disabled": 0},
			fields=["name", "label", "workspace", "sidebar", "icon", "abbr", "color", "image"],
			order_by="sequence asc, creation asc",
		)
	if configured:
		roles_of = {}
		for r in frappe.get_all("Dock Menu Role", filters={"parenttype": ITEM}, fields=["parent", "role"]):
			roles_of.setdefault(r.parent, set()).add(r.role)
		for c in configured:
			need = roles_of.get(c.name)
			if need and not (need & user_roles):
				continue
			ws = allowed.get(c.workspace) if c.workspace else None
			if c.workspace and not ws:
				continue  # workspace the user cannot open
			if not ws and not c.sidebar:
				continue
			items.append(
				{
					"key": c.name,
					"label": c.label,
					"workspace": c.workspace,
					"sidebar": c.sidebar,
					"icon": c.icon or (ws or {}).get("icon"),
					"abbr": c.abbr or ("" if c.icon or c.image else _initials(c.label)),
					"color": c.color,
					"image": c.image,
					"route": _ws_route(ws) if ws else None,
				}
			)
		return items

	for ws in allowed.values():
		if ws.get("parent_page"):
			continue
		items.append(
			{
				"key": ws["name"],
				"label": ws["title"],
				"workspace": ws["name"],
				"sidebar": None,
				"icon": ws.get("icon"),
				"abbr": "" if ws.get("icon") else _initials(ws["title"]),
				"color": None,
				"image": None,
				"route": _ws_route(ws),
				"private": 0 if ws.get("public") else 1,
			}
		)
	return _group_items(items, list(allowed.values()))


# ----------------------------------------------------------------------------- sidebar


def _route(link) -> str | None:
	lt, to = link["link_type"], link.get("link_to")
	if lt == "url":
		return link.get("url") or to
	if lt == "doctype":
		base = f"/desk/{_slug(to)}"
		view = link.get("doc_view") or ""
		if view == "Kanban" and link.get("kanban_board"):
			return f"{base}/view/kanban/{link['kanban_board']}"
		return f"{base}/{DOC_VIEW_PATH[view]}" if view in DOC_VIEW_PATH else base
	if lt == "report":
		rtype, ref = frappe.db.get_value("Report", to, ["report_type", "ref_doctype"]) or (None, None)
		if rtype in ("Query Report", "Script Report") or not ref:
			return f"/desk/query-report/{to}"
		return f"/desk/{_slug(ref)}/view/report/{to}"
	if lt == "page":
		return f"/desk/{to}"
	if lt == "dashboard":
		return f"/desk/dashboard-view/{to}"
	if lt == "workspace":
		ws = _allowed_workspaces().get(to)
		return _ws_route(ws) if ws else f"/desk/{_slug(to)}"
	return None


def _link(label, link_type, link_to, icon=None, url=None, new_tab=0, route_options=None, filters=None, checked=False, **extra):
	lt = (link_type or "").lower()
	to = link_to or (url if lt == "url" else None)
	if lt not in LINK_TYPES or not to or (not checked and not _can(lt, to)):
		return None
	row = {"type": "link", "label": label or to, "link_type": lt, "link_to": to, "icon": icon or ""}
	if lt == "url":
		row["url"] = url or to
	row.update({k: v for k, v in extra.items() if v})
	try:
		row["route"] = _route(row)
	except Exception:
		return None
	if not row["route"]:
		return None
	if new_tab or (lt == "url" and str(row["route"]).startswith("http")):
		row["new_tab"] = 1
	if route_options:
		row["route_options"] = route_options
	if filters:
		row["filters"] = filters
	return row


def _find_sidebar(item, ws):
	if not _table_ready("Workspace Sidebar"):
		return None
	try:
		if item.get("sidebar"):
			return frappe.get_cached_doc("Workspace Sidebar", item["sidebar"])
		if not ws:
			return None
		user = frappe.session.user
		for title in {ws.get("title"), ws.get("name")} - {None}:
			rows = frappe.get_all("Workspace Sidebar", filters={"title": title}, fields=["name", "for_user"])
			if not rows and frappe.db.exists("Workspace Sidebar", title):
				rows = [frappe._dict(name=title, for_user=None)]
			mine = [r for r in rows if r.for_user == user]
			common = [r for r in rows if not r.for_user]
			pick = (mine or common or [None])[0]
			if pick:
				return frappe.get_cached_doc("Workspace Sidebar", pick.name)
	except Exception:
		return None
	return None


def _blocks_from_sidebar(sidebar, allow=None) -> list[dict]:
	"""Ordered blocks: top-level links, spacers and collapsible sections.

	`allow(link_to, link_type)` replaces the default permission check (v14 rules)."""
	rows = sidebar.get("items") or []
	uses_child = any(r.get("child") for r in rows)
	blocks, section = [], None
	for r in rows:
		t = r.get("type") or "Link"
		if t == "Section Break":
			section = {
				"type": "section",
				"label": (r.get("label") or "").strip(),
				"icon": r.get("icon") or "",
				"collapsible": 1 if r.get("collapsible") in (None, "") else int(bool(r.get("collapsible"))),
				"keep_closed": int(bool(r.get("keep_closed"))),
				"items": [],
			}
			blocks.append(section)
			continue
		if t == "Spacer":
			section = None if uses_child else section
			blocks.append({"type": "spacer"})
			continue
		if t != "Link":
			continue
		if allow and not allow(r.get("link_to") or r.get("url"), r.get("link_type") or "DocType"):
			continue
		link = _link(
			r.get("label"),
			r.get("link_type") or "DocType",
			r.get("link_to"),
			icon=r.get("icon"),
			url=r.get("url"),
			new_tab=r.get("open_in_new_tab"),
			route_options=r.get("route_options"),
			filters=r.get("filters"),
			checked=bool(allow),
		)
		if not link:
			continue
		in_section = section is not None and (r.get("child") or not uses_child)
		if in_section:
			section["items"].append(link)
		else:
			section = None
			blocks.append(link)
	return blocks


def _blocks_from_workspace(ws) -> list[dict]:
	doc = frappe.get_cached_doc("Workspace", ws["name"])
	blocks, seen = [], set()

	def keep(link):
		if not link:
			return None
		k = (link["link_type"], link["link_to"], link.get("doc_view"))
		if k in seen:
			return None
		seen.add(k)
		return link

	for s in doc.get("shortcuts") or []:
		link = keep(
			_link(
				s.get("label"),
				s.get("type"),
				s.get("link_to"),
				icon=s.get("icon"),
				url=s.get("url"),
				doc_view=s.get("doc_view") if (s.get("type") or "").lower() == "doctype" else None,
				kanban_board=s.get("kanban_board"),
			)
		)
		if link:
			blocks.append(link)

	section, country = None, None
	for l in doc.get("links") or []:
		if l.get("type") == "Card Break":
			section = {"type": "section", "label": l.get("label") or _("Links"), "icon": l.get("icon") or "",
				"collapsible": 1, "keep_closed": 0, "items": []}
			blocks.append(section)
			continue
		if l.get("hidden"):
			continue
		if l.get("only_for"):
			country = country or frappe.db.get_single_value("System Settings", "country")
			if l.only_for != country:
				continue
		link = keep(_link(l.get("label"), l.get("link_type"), l.get("link_to")))
		if not link:
			continue
		if section is None:
			section = {"type": "section", "label": _("Links"), "icon": "", "collapsible": 1, "keep_closed": 0, "items": []}
			blocks.append(section)
		section["items"].append(link)
	return blocks


def _clean(blocks):
	out = []
	for b in blocks:
		if b["type"] == "section" and not b["items"]:
			continue
		if b["type"] == "spacer" and (not out or out[-1]["type"] == "spacer"):
			continue
		out.append(b)
	while out and out[-1]["type"] == "spacer":
		out.pop()
	return out


LAYOUT = "Dock Menu Layout"
TYPE_OF = {"DocType": "doctype", "Report": "report", "Page": "page", "Dashboard": "dashboard", "URL": "url", "Workspace": "workspace"}
TYPE_NAME = {v: k for k, v in TYPE_OF.items()}


def _layout_name(key, scope="user"):
	"""Name of the saved layout: the current user's own one, or the shared one (scope "all")."""
	if not key or not _table_ready(LAYOUT):
		return None
	has_user = frappe.get_meta(LAYOUT).has_field("for_user")
	if scope == "user" and has_user:
		return frappe.db.get_value(LAYOUT, {"menu_key": key, "for_user": frappe.session.user}, "name")
	if has_user:
		return frappe.db.get_value(LAYOUT, {"menu_key": key, "for_user": ["in", ["", None]]}, "name") or (
			frappe.db.get_value(LAYOUT, {"menu_key": key, "for_user": ["is", "not set"]}, "name"))
	return frappe.db.get_value(LAYOUT, {"menu_key": key}, "name")


def _layout(key, scope=None):
	"""The edited menu for this key: the user's own, else the shared one, else None (automatic menu)."""
	if not key or not _table_ready(LAYOUT):
		return None
	cache = _local_cache("dock_menu_layouts")
	ck = (key, scope)
	if ck not in cache:
		names = [_layout_name(key, "user"), _layout_name(key, "all")] if scope is None else [_layout_name(key, scope)]
		name = next((n for n in names if n), None)
		cache[ck] = frappe.get_cached_doc(LAYOUT, name) if name else None
	return cache[ck]


def _ws_allowed(name) -> bool:
	if _is_v14():
		return any(p["name"] == name for p in _v14_pages())
	return name in _allowed_workspaces()


def _permitted(lt, to) -> bool:
	if lt == "workspace":
		return _ws_allowed(to)
	if _is_v14():
		return _v14_allowed(to, lt)
	return _can(lt, to)


def _layout_blocks(lay) -> list[dict]:
	"""Blocks of an edited menu; links the user may not open are left out."""
	blocks, section = [], None
	skip = False  # inside a hidden section
	for e in sorted(lay.get("entries") or [], key=lambda r: r.idx or 0):
		t = e.entry_type or "Link"
		if t == "Section":
			skip = bool(e.hidden)
			section = None if skip else {"type": "section", "label": _(e.label or ""), "icon": e.icon or "",
				"collapsible": 1, "keep_closed": int(bool(e.collapsed)), "items": []}
			if section:
				blocks.append(section)
			continue
		if t == "Spacer":
			section, skip = None, False
			if not e.hidden:
				blocks.append({"type": "spacer"})
			continue
		in_sec = bool(e.in_section) and (section is not None or skip)
		if not in_sec:
			section, skip = None, False
		if e.hidden or (in_sec and skip):
			continue
		if t == "Sub-workspace":
			if not e.workspace or not _ws_allowed(e.workspace):
				continue
			title = frappe.db.get_value("Workspace", e.workspace, "title") or e.workspace
			link = _link(_(e.label or title), "workspace", e.workspace, icon=e.icon or "layout-grid", checked=True)
			if link:
				link.update({"lazy": 1, "ws": e.workspace})
				if e.own_only:
					link["own"] = 1
		else:
			lt = TYPE_OF.get(e.link_type or "", (e.link_type or "").lower())
			to = e.link_to or (e.url if lt == "url" else None)
			if not lt or not to or not _permitted(lt, to):
				continue
			link = _link(_(e.label or to), lt, to, icon=e.icon, url=e.url, new_tab=e.new_tab, checked=True)
		if not link:
			continue
		(section["items"] if in_sec and section is not None else blocks).append(link)
	return _clean(blocks)


def _entries_of(blocks, in_section=0) -> list[dict]:
	"""Editor rows for a menu (automatic or edited)."""
	rows = []

	def link_row(l, in_sec):
		if l["link_type"] == "workspace" and l.get("lazy"):
			rows.append({"entry_type": "Sub-workspace", "label": l["label"], "workspace": l.get("ws") or l["link_to"],
				"icon": l.get("icon") or "", "in_section": in_sec, "own_only": 1 if l.get("own") else 0})
			return
		if l.get("group"):
			rows.append({"entry_type": "Section", "label": l["label"], "icon": "" if l.get("icon") == "folder" else l.get("icon") or ""})
			for k in l.get("children") or []:
				link_row(k, 1)
			return
		if l["link_type"] == "workspace" and (l.get("lazy") or l.get("children")):
			rows.append({"entry_type": "Sub-workspace", "label": l["label"], "workspace": l.get("ws") or l["link_to"],
				"icon": l.get("icon") or "", "in_section": in_sec, "own_only": 1 if (l.get("own") or (l.get("children") and not l.get("lazy"))) else 0})
			return
		rows.append({"entry_type": "Link", "label": l["label"], "link_type": TYPE_NAME.get(l["link_type"], ""),
			"link_to": "" if l["link_type"] == "url" else l["link_to"], "url": l.get("url") or (l["link_to"] if l["link_type"] == "url" else ""),
			"icon": l.get("icon") or "", "in_section": in_sec, "new_tab": 1 if l.get("new_tab") else 0})

	for b in blocks:
		if b["type"] == "spacer":
			rows.append({"entry_type": "Spacer", "in_section": 0})
		elif b["type"] == "section":
			rows.append({"entry_type": "Section", "label": b["label"], "icon": b.get("icon") or "", "collapsed": b.get("keep_closed") or 0})
			for l in b["items"]:
				link_row(l, 1)
		else:
			link_row(b, in_section)
	return rows


def _lazify(entries, own=None):
	"""Any link to another workspace (a sidebar's "Documents" under "Admin", a card's workspace link…)
	becomes an expandable entry whose menu is loaded when opened."""
	def walk(links):
		for l in links:
			if l.get("type") == "section":
				walk(l.get("items") or [])
				continue
			if l.get("type") != "link":
				continue
			if l.get("link_type") == "workspace" and not l.get("lazy") and not l.get("children") and l.get("link_to") != own:
				l.update({"lazy": 1, "ws": l["link_to"]})
			walk(l.get("children") or [])
	walk(entries or [])
	return entries


def _menu(item) -> dict:
	"""Sidebar of a dock icon: the edited menu when there is one, else the automatic one."""
	lay = _layout(item.get("key"))
	if lay:
		m = {"key": item["key"], "title": _(lay.menu_title) if lay.menu_title else item["label"],
			"blocks": _layout_blocks(lay), "route": item.get("route"), "header_icon": item.get("icon"), "edited": 1}
	else:
		m = _auto_menu(item)
	_lazify(m["blocks"], item.get("workspace") if not item.get("members") else None)
	return m


def _auto_menu(item) -> dict:
	if _is_v14():
		return _v14_item_menu(item)
	if item.get("members"):
		allowed = _allowed_workspaces()
		blocks, used = [], set()
		for m in item["members"]:
			ws = allowed.get(m["workspace"])
			if not ws or ws["name"] in used:
				continue
			used.add(ws["name"])
			if m.get("home"):
				for e in _submenu(ws["name"]) or []:
					if e.get("ws") and e["ws"] in used:
						continue
					if e.get("ws"):
						used.add(e["ws"])
					blocks.append(e)
				continue
			node = _link(m["label"], "workspace", ws["name"], icon=m.get("icon") or "layout-grid", checked=True) if ws else None
			if node:
				node.update({"lazy": 1, "ws": ws["name"]})
				blocks.append(node)
		return {"key": item["key"], "title": item["label"], "blocks": blocks, "route": item.get("route"),
			"header_icon": item.get("icon")}
	ws = _allowed_workspaces().get(item.get("workspace")) if item.get("workspace") else None
	sidebar = _find_sidebar(item, ws)
	if sidebar:
		blocks = _blocks_from_sidebar(sidebar)
	elif ws:
		blocks = _blocks_from_workspace(ws)
	else:
		blocks = []
	own = ws["name"] if ws else None
	for b in _flat_links(blocks):
		# another workspace linked from this sidebar: expandable, loaded on demand
		if b["link_type"] == "workspace" and b["link_to"] != own:
			b.update({"lazy": 1, "ws": b["link_to"]})
	return {
		"key": item["key"],
		"title": item["label"],
		"blocks": _clean(blocks),
		"route": item.get("route"),
		"header_icon": (sidebar.get("header_icon") if sidebar else None) or item.get("icon"),
	}


def _routes(menu):
	def walk(links):
		for l in links:
			yield l["route"]
			yield from walk(l.get("children") or [])

	for b in menu["blocks"]:
		if b["type"] == "link":
			yield from walk([b])
		elif b["type"] == "section":
			yield from walk(b["items"])


def _matches(path, route) -> int:
	if not route or not path or not route.startswith("/desk"):
		return 0
	path, route = path.rstrip("/"), route.rstrip("/")
	return len(route) if path == route or path.startswith(route + "/") else 0


def _submenu(workspace, own_only=False) -> list[dict] | None:
	"""Entries of one workspace's menu for nesting (None: the user may not open it)."""
	if not _ws_allowed(workspace):
		return None
	lay = _layout("ws:" + workspace)
	if lay:
		out = _as_nested(_layout_blocks(lay))
	else:
		out = _auto_submenu(workspace)
	if out is not None:
		_lazify(out, workspace)
	if out is not None and own_only:
		# without its sub-workspaces (e.g. "HR" inside HR): its own entries only
		if len(out) and out[0].get("link_to") == workspace and out[0].get("children") and not out[0].get("lazy"):
			out = out[0]["children"]
		out = [e for e in out if not (e.get("lazy") or e.get("child_ws"))]
	return out


def _as_nested(blocks) -> list[dict]:
	out = []
	for b in blocks:
		if b["type"] == "link":
			out.append(b)
		elif b["type"] == "section" and b["items"]:
			out.append(_group(b["label"] or _("Links"), b["items"], b.get("icon")))
	return out


def _auto_submenu(workspace) -> list[dict] | None:
	if _is_v14():
		w = next((p for p in _v14_pages() if p["name"] == workspace), None)
		return _nested(w) if w else None
	ws = _allowed_workspaces().get(workspace)
	if not ws:
		return None
	m = _auto_menu({"key": ws["name"], "label": ws["title"], "workspace": ws["name"], "route": _ws_route(ws)})
	out = []
	for b in m["blocks"]:
		if b["type"] == "link":
			if not (b["link_type"] == "workspace" and b["link_to"] == ws["name"]):
				out.append(b)
		elif b["type"] == "section" and b["items"]:
			out.append(_group(b["label"] or _("Links"), b["items"], b.get("icon")))
	return out


def _expand(links, seen=None, chain=()):
	"""Fill lazy entries (recursively) for search and locate. Yields (link, chain of lazy workspaces, trail of labels)."""
	seen = set(seen or ())
	for l in links:
		yield l, chain
		kids = l.get("children") or []
		if l.get("lazy") and not kids and l.get("ws") not in seen:
			kids = _submenu(l["ws"], bool(l.get("own"))) or []
		sub_seen = seen | ({l["ws"]} if l.get("lazy") else set())
		sub_chain = chain + ((l["ws"],) if l.get("lazy") else ())
		for k, c in _expand(kids, sub_seen, sub_chain):
			k.setdefault("_trail", [])
			if not k.get("_trail_set"):
				k["_trail"] = (l.get("_trail") or []) + [l["label"]]
				k["_trail_set"] = 1
			yield k, c


def _all_links(menu):
	"""Every link of a menu, lazy workspaces included: (link, lazy chain)."""
	tops = []
	for b in menu["blocks"]:
		if b["type"] == "link":
			b["_trail"], b["_trail_set"] = [], 1
			tops.append(b)
		elif b["type"] == "section":
			for l in b["items"]:
				l["_trail"], l["_trail_set"] = ([b["label"]] if b["label"] else []), 1
				tops.append(l)
	return list(_expand(tops))


def _locate(items, path):
	"""Key of the dock icon whose workspace or menu best matches the path."""
	if not path:
		return None
	best, score = None, 0
	for it in items:
		s = _matches(path, it.get("route"))
		if s > score:
			best, score = it["key"], s + 1000  # the workspace page itself wins
	if best:
		return best
	keys = {it["key"] for it in items}
	for row in _index():  # every menu, sub-workspaces included (cached)
		s = _matches(path, row["route"])
		if s > score and row["key"] in keys:
			best, score = row["key"], s
	return best


# ----------------------------------------------------------------------------- v14 style

V14_DIR = os.path.join(os.path.dirname(__file__), "v14_workspaces")
_V14_BUNDLE = None


def _v14_bundle() -> dict:
	"""v14 menus shipped with this app (HRMS v14: HR, Recruitment, Employee Lifecycle, Performance,
	Shift & Attendance, Expense Claims, Leaves), by workspace name and title.

	v16 emptied these workspace pages (their menus moved to v16 sidebars) and dropped "HR";
	the v14 style uses these so the menus look as they did in v14."""
	global _V14_BUNDLE
	if _V14_BUNDLE is None:
		out = {}
		try:
			for fn in sorted(os.listdir(V14_DIR)):
				if fn.endswith(".json"):
					with open(os.path.join(V14_DIR, fn)) as f:
						d = json.load(f)
					for k in (d.get("name"), d.get("title")):
						if k:
							out.setdefault(k, d)
		except Exception:
			out = {}
		_V14_BUNDLE = out
	return _V14_BUNDLE


# v16 renamed two HR workspaces; when the v14 one is there, the v16 one is not listed again
V16_ALIASES = {"Expenses": "Expense Claims", "Tenure": "Employee Lifecycle"}


def _parent_of(w) -> str:
	"""Parent workspace title: the page's own parent_page, else the v14 one (HR for Recruitment,
	Employee Lifecycle, Performance, Shift & Attendance, Expense Claims, Leaves)."""
	if w.get("parent_page"):
		return w["parent_page"]
	b = _v14_bundle().get(w.get("name")) or _v14_bundle().get(w.get("title")) or {}
	return b.get("parent_page") or ""


def _drop_aliases(pages) -> list:
	names = {p["name"] for p in pages} | {p.get("title") for p in pages}
	return [p for p in pages if V16_ALIASES.get(p["name"]) not in names]


def _v14_source(doc):
	"""The workspace's own v14 content, or the bundled v14 menu when the page has none."""
	if doc.get("shortcuts") or doc.get("links"):
		return doc
	b = _v14_bundle().get(doc.name) or _v14_bundle().get(doc.get("title"))
	if not b:
		return doc
	rows = lambda key: [frappe._dict(r) for r in b.get(key) or []]
	return frappe._dict(
		name=doc.name,
		title=doc.get("title") or doc.name,
		module=b.get("module") or doc.get("module"),
		hide_custom=b.get("hide_custom") or doc.get("hide_custom"),
		shortcuts=rows("shortcuts"),
		links=rows("links"),
		quick_lists=rows("quick_lists"),
	)


def _v14_scan() -> list[dict]:
	"""Every workspace with v14's verdict for the current user: {..., "shown": bool, "reason": str}.

	Same rules as Frappe v14 (frappe.desk.desktop.get_workspace_sidebar_items + Workspace.is_permitted):
	• Workspace Manager: every workspace, hidden ones included
	• others: domain active, module not blocked and in the user's allowed modules (modules with a
	  DocType they can read), and the workspace's Roles (+ Custom Role) empty or shared
	• public pages unless hidden or "Welcome Workspace"; private pages only for their own user
	Order: public pages, then the user's private pages, each by sequence.
	"""
	user = frappe.session.user
	roles = set(frappe.get_roles())
	has_access = "Workspace Manager" in roles

	meta = frappe.get_meta("Workspace")
	wanted = ["title", "for_user", "parent_page", "public", "module", "icon", "is_hidden", "restrict_to_domain", "sequence_id"]
	fields = ["name"] + [f for f in wanted if meta.has_field(f)]
	order = "sequence_id asc, name asc" if meta.has_field("sequence_id") else "name asc"
	rows = frappe.get_all("Workspace", fields=fields, order_by=order, ignore_permissions=True)

	try:
		blocked = set(frappe.get_cached_doc("User", user).get_blocked_modules() or [])
	except Exception:
		blocked = set()
	try:
		domains = set(frappe.get_active_domains() or [])
	except Exception:
		domains = None
	u = frappe.get_user()
	if not getattr(u, "allow_modules", None):
		u.build_permissions()
	allow_modules = set(u.allow_modules or [])
	# modules that own DocTypes; HRMS v16 files its workspaces under navigation-only modules
	# (Leaves, Expenses, Recruitment…) whose DocTypes stay in "HR"
	doctype_modules = {r[0] for r in frappe.db.sql("select distinct module from `tabDocType`")}
	ws_roles = {}
	for r in frappe.get_all("Has Role", filters={"parenttype": "Workspace"}, fields=["parent", "role"]):
		ws_roles.setdefault(r.parent, set()).add(r.role)
	try:
		from frappe.core.doctype.custom_role.custom_role import get_custom_allowed_roles
	except Exception:
		get_custom_allowed_roles = None

	out = []
	for w in rows:
		w["title"] = w.get("title") or w.name
		w["public"] = int(bool(w.get("public")))
		reason = ""
		if not has_access:
			need = set(ws_roles.get(w.name, set()))
			if get_custom_allowed_roles:
				try:
					need |= set(get_custom_allowed_roles("page", w.name) or [])
				except Exception:
					pass
			if w.get("restrict_to_domain") and domains is not None and w.restrict_to_domain not in domains:
				reason = f"domain {w.restrict_to_domain} not active"
			elif w.get("module") and w.module in blocked and w.module != APP_MODULE:
				reason = f"module {w.module} blocked for user"
			elif w.get("module") and w.module != APP_MODULE and w.module in doctype_modules and w.module not in allow_modules:
				reason = f"module {w.module}: user cannot read any of its DocTypes"
			elif need and not (need & roles):
				reason = "needs role: " + ", ".join(sorted(need))
		if not reason:
			if w["public"]:
				if w.get("is_hidden") and not has_access:
					reason = "hidden"
				elif w["title"] == "Welcome Workspace":
					reason = "Welcome Workspace"
			elif w.get("for_user") != user:
				reason = f"private page of {w.get('for_user') or 'nobody'}"
		w["shown"] = not reason
		w["reason"] = reason
		# no DocTypes to judge the module by: shown only if the user can open something on it
		w["nav_module"] = int(bool(w.get("module")) and (w.get("module") not in doctype_modules or w.get("module") == APP_MODULE)
			and not has_access)
		out.append(w)
	return out


def _v14_pages() -> list[dict]:
	"""Workspaces the v14 desk sidebar would list for the current user, in v14 order."""
	if hasattr(frappe.local, "dock_menu_v14"):
		return frappe.local.dock_menu_v14
	scan = _v14_scan()
	frappe.local.dock_menu_v14_scan = scan
	shown = [w for w in scan if w["shown"]]
	pages = [w for w in shown if w["public"]] + [w for w in shown if not w["public"]]
	frappe.local.dock_menu_v14 = pages
	# only workspaces with something the user may open: its own items, or a child workspace that has some
	keep = {w["name"] for w in pages if _clean(_v14_blocks(w, children=False))}
	by_title = {(w["title"], w["public"]): w for w in pages}
	for w in pages:
		if w["name"] not in keep:
			continue
		parent = by_title.get((_parent_of(w), w["public"])) if _parent_of(w) else None
		while parent and parent["name"] not in keep:
			keep.add(parent["name"])
			parent = by_title.get((_parent_of(parent), parent["public"])) if _parent_of(parent) else None
	pages = _drop_aliases([w for w in pages if w["name"] in keep])
	pages = _add_containers(pages)
	frappe.local.dock_menu_v14 = pages
	return pages


def _add_containers(pages) -> list[dict]:
	"""A parent workspace whose sub-workspaces the user may open stays the main menu even when the user
	may not open the parent itself (or it no longer exists, e.g. HR after v16): it is added as a
	container that only holds its sub-workspaces."""
	user = frappe.session.user
	scan = frappe.local.dock_menu_v14_scan if hasattr(frappe.local, "dock_menu_v14_scan") else []
	order = {w["name"]: i for i, w in enumerate(scan)}
	by_title = {}
	for w in scan:
		if w["public"] or w.get("for_user") == user:
			by_title.setdefault((w["title"], w["public"]), w)
	have = {(w["title"], w["public"]) for w in pages}
	out = list(pages)
	todo = list(pages)
	while todo:
		w = todo.pop()
		pt = _parent_of(w)
		if not pt or (pt, w["public"]) in have:
			continue
		par = by_title.get((pt, w["public"]))
		if par:
			c = dict(par, container=1, shown=True)
		else:
			b = _v14_bundle().get(pt)
			if not b or not w["public"]:
				continue
			c = frappe._dict(name=pt, title=b.get("title") or pt, public=1, icon=b.get("icon"), module=b.get("module"),
				parent_page=b.get("parent_page") or "", container=1, virtual=1, shown=True)
		have.add((c["title"], c["public"]))
		out.append(c)
		todo.append(c)
	for c in out:
		if c.get("virtual"):  # placed where its first sub-workspace was
			kids = [order.get(k["name"], 10**6) for k in out if _parent_of(k) == c["title"] and k["name"] in order]
			order[c["name"]] = (min(kids) if kids else 10**6) - 0.5
	pub = sorted([w for w in out if w["public"]], key=lambda w: order.get(w["name"], 10**6))
	priv = sorted([w for w in out if not w["public"]], key=lambda w: order.get(w["name"], 10**6))
	return pub + priv


def _v14_children(w) -> list[dict]:
	"""Child workspaces (parent_page = this title), same visibility, as v14 nested them."""
	return [c for c in _v14_pages() if c is not w and _parent_of(c) == w["title"] and c["public"] == w["public"]]


def _v14_dock_items() -> list[dict]:
	"""One dock icon per top-level workspace of the v14 sidebar (public, then the user's private ones).

	A workspace whose parent the user cannot see is shown on its own. Dock Menu Item records only
	restyle an icon here (label, icon, letters, colour, image); v14's rules decide what is shown."""
	pages = _v14_pages()
	look = {}
	if _table_ready(ITEM):
		for c in frappe.get_all(ITEM, filters={"disabled": 0}, fields=["workspace", "label", "icon", "abbr", "color", "image"]):
			if c.workspace:
				look[c.workspace] = c
	items = []
	for w in pages:
		siblings = {p["title"] for p in pages if p["public"] == w["public"] and p is not w}
		if _parent_of(w) and _parent_of(w) in siblings:
			continue  # listed under its parent (e.g. Recruitment under HR)
		c = look.get(w["name"]) or {}
		label = c.get("label") or _(w["title"])
		icon = c.get("icon") or w.get("icon")
		items.append(
			{
				"key": w["name"],
				"label": label,
				"workspace": w["name"],
				"sidebar": None,
				"icon": icon,
				"abbr": c.get("abbr") or ("" if icon or c.get("image") else _initials(label)),
				"color": c.get("color"),
				"image": c.get("image"),
				"route": _container_route(w) if w.get("container") else _ws_route(w),
				"private": 0 if w["public"] else 1,
			}
		)
	return _group_items(items, pages)


def _container_route(w):
	"""Where a container's dock icon goes: its first sub-workspace the user may open."""
	for c in _v14_children(w):
		if not c.get("container"):
			return _ws_route(c)
		r = _container_route(c)
		if r:
			return r
	return None


def _group_items(items, pages) -> list[dict]:
	"""Fold dock icons that v16 files under one app (Desktop Icon parent) into a single icon,
	in the place of the first of them. A group with one visible workspace stays a plain icon."""
	groups = _desktop_groups()
	if not groups:
		return items
	title_of = {p["name"]: p["title"] for p in pages}
	def group_of(it):
		g = groups.get(it["workspace"]) or groups.get(title_of.get(it["workspace"]))
		return g if g and it["private"] == 0 else None
	counts = {}
	for it in items:
		g = group_of(it)
		if g:
			counts[g["name"]] = counts.get(g["name"], 0) + 1
	# a workspace titled like a group (v14 "Accounting" next to v16's Accounting folder) opens that group,
	# as its first entry
	labels = {}
	for it in items:
		g = group_of(it)
		if g and counts[g["name"]] >= 2:
			labels.setdefault(_(g["label"]).lower(), g)
			labels.setdefault(g["name"].lower(), g)
	def home_of(it):
		if group_of(it) or it.get("private"):
			return None
		return labels.get((it.get("label") or "").lower()) or labels.get((title_of.get(it["workspace"]) or "").lower())
	homes = {}
	for it in items:
		g = home_of(it)
		if g and g["name"] not in homes:
			homes[g["name"]] = it
	out, placed = [], {}
	for it in items:
		if any(h is it for h in homes.values()):
			continue
		g = group_of(it)
		if not g or counts[g["name"]] < 2:
			out.append(it)
			continue
		member = {"workspace": it["workspace"], "label": g.get("member_label") or it["label"],
			"icon": g.get("member_icon") or it["icon"], "route": it["route"]}
		if g["name"] in placed:
			placed[g["name"]]["members"].append(member)
			continue
		grp = {
			"key": "group:" + g["name"],
			"label": _(g["label"]),
			"workspace": it["workspace"],
			"sidebar": None,
			"icon": g.get("icon") or "",
			"abbr": "" if (g.get("icon") or g.get("image")) else _initials(g["label"]),
			"color": None,
			"image": g.get("image"),
			"route": it["route"],
			"private": 0,
			"members": [member],
		}
		home = homes.get(g["name"])
		if home:
			grp["members"].insert(0, {"workspace": home["workspace"], "label": home["label"], "icon": home.get("icon"),
				"route": home["route"], "home": 1})
			grp["route"] = home["route"]
			grp["workspace"] = home["workspace"]
		placed[g["name"]] = grp
		out.append(grp)
	# a home whose group did not form (fewer than two members) stays a plain icon
	for name, h in homes.items():
		if name not in placed:
			out.append(h)
	return out


def _desktop_groups() -> dict:
	"""v16 app grouping from Desktop Icons: {workspace name or title: group}, where a group is
	{"name", "label", "image", "icon", "members": {workspace key: member icon}} for icons whose
	parent is an App / Folder icon (HRMS v16: Leaves, Expenses… under "Frappe HR")."""
	if hasattr(frappe.local, "dock_menu_groups"):
		return frappe.local.dock_menu_groups
	out = {}
	try:
		if _table_ready("Desktop Icon"):
			meta = frappe.get_meta("Desktop Icon")
			want = ["label", "icon_type", "link_type", "link_to", "parent_icon", "icon", "logo_url", "hidden", "idx"]
			fields = ["name"] + [f for f in want if meta.has_field(f)]
			rows = frappe.get_all("Desktop Icon", fields=fields, order_by="idx asc, creation asc")
			by_label = {}
			for r in rows:
				by_label.setdefault(r.get("label") or r.name, r)
				by_label.setdefault(r.name, r)
			for r in rows:
				parent = by_label.get(r.get("parent_icon")) if r.get("parent_icon") else None
				if not parent or (parent.get("icon_type") not in ("App", "Folder")):
					continue
				if parent.get("hidden") or r.get("hidden"):
					continue  # the v16 desktop shows these as separate icons (e.g. ERPNext's modules)
				target = r.get("link_to")
				if not target or r.get("link_type") not in ("Workspace Sidebar", "Workspace", None, ""):
					continue
				label = parent.get("label") or parent.name
				grp = {"name": parent.name, "label": label[7:] if label.startswith("Frappe ") else label,
					"image": parent.get("logo_url"), "icon": parent.get("icon")}
				out[target] = {**grp, "member_icon": r.get("icon"), "member_label": r.get("label")}
	except Exception:
		out = {}
	frappe.local.dock_menu_groups = out
	return out


def _v14_rules():
	"""The checks v14's desk used for workspace items (frappe.desk.desktop.Workspace.is_item_allowed)."""
	if hasattr(frappe.local, "dock_menu_v14_rules"):
		return frappe.local.dock_menu_v14_rules
	u = frappe.get_user()
	if not getattr(u, "can_read", None):
		u.build_permissions()
	can_read = set(u.can_read or [])

	get_pages = get_reports = None
	try:
		from frappe.boot import get_allowed_pages as get_pages, get_allowed_reports as get_reports  # v14 / v15
	except ImportError:
		try:
			from frappe.desk.desk_views import DeskViews  # v16

			get_pages, get_reports = DeskViews.get_allowed_pages, DeskViews.get_allowed_reports
		except Exception:
			pass
	try:
		pages = set(get_pages(cache=True)) if get_pages else None
	except Exception:
		pages = None
	try:
		reports = dict(get_reports(cache=True)) if get_reports else None
	except Exception:
		reports = None

	restricted = frappe.cache.get_value("domain_restricted_pages")
	if restricted is None:
		try:
			from frappe import cache_manager

			build = getattr(cache_manager, "build_domain_restricted_page_cache", None) or getattr(
				cache_manager, "build_domain_restriced_page_cache", None
			)
			restricted = build() if build else None
		except Exception:
			restricted = None
	rules = frappe._dict(
		admin=frappe.session.user == "Administrator",
		can_read=can_read,
		pages=pages,
		reports=reports,
		restricted_pages=set(restricted) if restricted is not None else None,
		domains=set(frappe.get_active_domains() or []),
		country=frappe.db.get_default("country") or frappe.db.get_single_value("System Settings", "country"),
	)
	frappe.local.dock_menu_v14_rules = rules
	return rules


def _v14_allowed(name, item_type) -> bool:
	"""v14's is_item_allowed, tightened so only items the user can really open are listed."""
	r = _v14_rules()
	if r.admin:
		return True
	t = (item_type or "").lower()
	if t == "doctype":
		# v14 also counted DocTypes where only a shared document is readable; require a read role
		return name in r.can_read and _strict("doctype", name)
	if t == "page":
		if r.pages is None:
			return _can("page", name)
		return name in r.pages and (r.restricted_pages is None or name in r.restricted_pages)
	if t == "report":
		ok = _can("report", name) if r.reports is None else name in r.reports
		# a report without roles is "allowed" to everyone; it still needs its DocType to be readable
		return ok and _strict("report", name)
	if t == "dashboard":
		return _strict("dashboard", name)
	if t == "workspace":
		return any(p["name"] == name for p in _v14_pages())
	return t in ("help", "url")


def _strict(kind, name) -> bool:
	cache = _local_cache("dock_menu_strict")
	key = (kind, name)
	if key not in cache:
		ok = False
		try:
			if kind == "doctype":
				ok = bool(frappe.db.exists("DocType", name)) and bool(frappe.has_permission(name, "read"))
			elif kind == "report":
				ref = frappe.db.get_value("Report", name, "ref_doctype")
				ok = not ref or _strict("doctype", ref)
			elif kind == "dashboard":
				ok = bool(frappe.db.exists("Dashboard", name)) and bool(frappe.has_permission("Dashboard", "read"))
		except Exception:
			ok = False
		cache[key] = ok
	return cache[key]


def _v14_link_groups(doc) -> list[dict]:
	"""Workspace.get_link_groups (v14): Card Breaks start cards; a card for another country is dropped."""
	country = _v14_rules().country
	cards, current, links = [], frappe._dict(label="Link", type="Card Break", hidden=0), []
	for l in doc.get("links") or []:
		l = frappe._dict(l.as_dict() if callable(getattr(l, "as_dict", None)) else l)
		if l.type == "Card Break":
			if links and (not current.get("only_for") or current.get("only_for") == country):
				current["links"] = links
				cards.append(current)
			current, links = l, []
		else:
			links.append(l)
	if links and (not current.get("only_for") or current.get("only_for") == country):
		current["links"] = links
		cards.append(current)
	return cards


def _v14_custom_cards(module) -> list[dict]:
	"""get_custom_reports_and_doctypes (v14): the module's custom DocTypes and non-standard reports."""
	if not module:
		return []
	doctypes = frappe.get_all("DocType", filters={"custom": 1, "istable": 0, "module": module}, pluck="name", order_by="name")
	reports = frappe.get_all("Report", filters={"is_standard": "No", "disabled": 0, "module": module}, pluck="name", order_by="name")
	return [
		frappe._dict(label=_("Custom Documents"), links=[frappe._dict(type="Link", link_type="DocType", link_to=d, label=_(d)) for d in doctypes]),
		frappe._dict(label=_("Custom Reports"), links=[frappe._dict(type="Link", link_type="Report", link_to=r, label=_(r)) for r in reports]),
	]


def _v14_blocks(w, children=True) -> list[dict]:
	"""Sidebar of one workspace, with the items v14 showed on that workspace for this user:
	child workspaces, shortcuts, quick lists, then link cards (+ Custom Documents / Reports)."""
	if w.get("container"):
		doc = frappe._dict(name=w["name"], shortcuts=[], links=[], quick_lists=[], hide_custom=1)
	else:
		doc = _v14_source(frappe.get_cached_doc("Workspace", w["name"]))
	blocks, seen = [], set()

	def add(link, to=None):
		if not link:
			return None
		k = (link["link_type"], link["link_to"], link.get("doc_view"))
		if k in seen:
			return None
		seen.add(k)
		(to if to is not None else blocks).append(link)
		return link

	kids = _v14_children(w) if children else []
	for c in kids:
		if c.get("container"):
			# a parent the user cannot open: an entry without a page, holding its sub-workspaces
			node = add(dict(_group(_(c["title"]), [], c.get("icon") or "layout-grid"), link_type="workspace", link_to=c["name"]))
		else:
			node = add(_link(_(c["title"]), "workspace", c["name"], icon=c.get("icon") or "layout-grid", checked=True))
		if node:
			# its menu is loaded when the entry is opened (get_submenu)
			node.update({"child_ws": 1, "lazy": 1, "ws": c["name"]})

	domains = _v14_rules().domains
	for sc in doc.get("shortcuts") or []:
		t = sc.get("type") or ""
		if sc.get("restrict_to_domain") and sc.restrict_to_domain not in domains:
			continue
		if not _v14_allowed(sc.get("link_to"), t):
			continue
		add(_link(_(sc.get("label")) if sc.get("label") else _(sc.get("link_to") or ""), t, sc.get("link_to"),
			icon=sc.get("icon"), url=sc.get("url"), checked=True,
			doc_view=sc.get("doc_view") if t.lower() == "doctype" else None, kanban_board=sc.get("kanban_board")))

	quick_at = len(blocks)  # quick lists go after the shortcuts, unless a card already links them

	cards = _v14_link_groups(doc)
	if not doc.get("hide_custom"):
		cards += _v14_custom_cards(doc.get("module"))
	for card in cards:
		if card.get("hidden"):
			continue
		section = {"type": "section", "label": _(card.get("label") or ""), "icon": card.get("icon") or "",
			"collapsible": 1, "keep_closed": 0, "items": []}
		for l in card.get("links") or []:
			if l.get("hidden") or not _v14_allowed(l.get("link_to"), l.get("link_type")):
				continue
			add(_link(_(l.get("label")) if l.get("label") else _(l.get("link_to") or ""), l.get("link_type"), l.get("link_to"),
				icon=l.get("icon"), checked=True), section["items"])
		if section["items"]:
			blocks.append(section)

	quick = []
	for q in doc.get("quick_lists") or []:
		dt = q.get("document_type")
		if dt and _v14_allowed(dt, "doctype"):
			add(_link(_(q.get("label")) if q.get("label") else _(dt), "doctype", dt, checked=True, filters=q.get("quick_list_filter")), quick)
	blocks[quick_at:quick_at] = quick

	# v16 apps (HRMS v16, ERPNext v16…) keep a workspace's menu in its Workspace Sidebar and leave
	# the page without shortcuts or cards: use that sidebar, with v14's item rules
	has_own = bool(doc.get("shortcuts") or doc.get("links"))
	# custom workspaces (made on this site) also get the items of their v16 Workspace Sidebar
	if (not has_own or _is_custom_ws(w)) and not w.get("container"):
		sidebar = _find_sidebar({"sidebar": None}, w)
		if sidebar:
			extra = [b for b in _blocks_from_sidebar(sidebar, allow=_v14_allowed)
				if not (b["type"] == "link" and b["link_type"] == "workspace" and b["link_to"] == w["name"])]
			for b in extra:
				if b["type"] == "link":
					add(b)
				elif b["type"] == "section":
					sec = {**b, "items": []}
					for l in b["items"]:
						add(l, sec["items"])
					if sec["items"]:
						blocks.append(sec)
				else:
					blocks.append(b)

	# a workspace that only groups others: open its single child straight away
	if len(blocks) == 1 and blocks[0]["type"] == "link" and (blocks[0].get("children") or blocks[0].get("lazy")):
		blocks[0]["open"] = 1
	return blocks


def _group(label, items, icon=None) -> dict:
	"""A sub-menu without a page of its own (a v14 card), shown as an expandable entry."""
	return {"type": "link", "group": 1, "label": label, "link_type": "group", "link_to": label,
		"icon": icon or "folder", "route": None, "children": items}


def _nested(w) -> list[dict]:
	"""A workspace's menu as entries for nesting under its node: shortcuts and quick lists, then one
	expandable entry per card. When it also has child workspaces, its own menu goes first, in an
	entry named after it (e.g. "HR" under HR), followed by the child workspaces."""
	kids, own = [], []
	for b in _clean(_v14_blocks(w)):
		if b["type"] == "link":
			(kids if b.get("child_ws") else own).append(b)
		elif b["type"] == "section" and b["items"]:
			own.append(_group(b["label"] or _("Links"), b["items"], b.get("icon")))
	if kids and own:
		home = _link(_(w["title"]), "workspace", w["name"], icon=w.get("icon") or "layout-grid", checked=True)
		if home:
			home["children"] = own
			home["open"] = 0
			return [home] + kids
	return kids + own


def _is_custom_ws(w) -> bool:
	cache = _local_cache("dock_menu_custom_ws")
	if w["name"] not in cache:
		mod = w.get("module") or frappe.db.get_value("Workspace", w["name"], "module")
		ok = not mod
		if mod:
			try:
				ok = bool(frappe.db.get_value("Module Def", mod, "custom")) or frappe.db.get_value("Module Def", mod, "app_name") not in frappe.get_installed_apps()
			except Exception:
				ok = False
		cache[w["name"]] = ok
	return cache[w["name"]]


def _flat_links(blocks) -> list[dict]:
	out = []
	for b in blocks:
		if b["type"] == "link":
			out.append(b)
		elif b["type"] == "section":
			out.extend(b["items"])
	return out


def _v14_item_menu(item) -> dict:
	if item.get("members"):
		# one expandable entry per workspace of the app, holding that workspace's menu
		pages = {p["name"]: p for p in _v14_pages()}
		blocks, used = [], set()
		for m in item["members"]:
			w = pages.get(m["workspace"])
			if not w or w["name"] in used or V16_ALIASES.get(w["name"]) in used:
				continue
			used.add(w["name"])
			if m.get("home"):
				# the group's own workspace: its menu and its child workspaces at the top
				for e in _nested(w):
					k = e.get("ws") or e.get("link_to")
					if e.get("ws") and k in used:
						continue
					used.add(k)
					blocks.append(e)
				continue
			node = _link(m["label"], "workspace", w["name"], icon=m.get("icon") or "layout-grid", checked=True)
			if not node:
				continue
			node.update({"lazy": 1, "ws": w["name"]})
			blocks.append(node)
		return {"key": item["key"], "title": item["label"], "blocks": blocks, "route": item.get("route"),
			"header_icon": item.get("icon")}
	w = next((p for p in _v14_pages() if p["name"] == item.get("workspace")), None)
	blocks = []
	if w and _v14_children(w):
		blocks = _nested(w)
	elif w:
		blocks = _clean(_v14_blocks(w))
	return {
		"key": item["key"],
		"title": item["label"],
		"blocks": blocks,
		"route": item.get("route"),
		"header_icon": item.get("icon"),
	}


def _v14_landing() -> dict:
	pages = _v14_pages()
	return {
		# v14 opens the last visited workspace, else the first one in this order
		"landing": [
			{"name": p["name"], "route": _ws_route(p),
				"alias": None if p["public"] else f"/desk/private/{_slug(p.get('title') or p['name'])}"}
			for p in pages if not p.get("container")
		],
		# pages v16 left out of frappe.workspaces: the client registers them so their routes open
		"register": [
			{k: p.get(k) for k in ("name", "title", "public", "for_user", "module", "icon", "parent_page", "is_hidden", "sequence_id")}
			for p in pages if not p.get("container")
		],
	}


# ----------------------------------------------------------------------------- public API


@frappe.whitelist()
def get_dock(path: str | None = None, key: str | None = None):
	"""Dock icons for the current user, plus the menu of the active icon.

	Active icon: the one matching `path` (workspace page or a sidebar link), else `key`
	(last used, from the browser), else the first icon."""
	settings = _settings()
	if not _enabled(settings):
		return {"enabled": 0}
	base = {
		"enabled": 1,
		"is_manager": int(MANAGER in frappe.get_roles()),
		"can_edit": int(_can_edit()),
		"settings": {k: settings[k] for k in ("open_workspace_on_desk", "landing_page", "home_route", "dock_limit", "click_opens", "show_search", "show_full_width",
			"show_notifications", "show_todo")},
		"subtitle": _subtitle(settings),
	}
	items = _dock_items()
	keys = {i["key"] for i in items}
	active = _locate(items, path)
	if not active and key in keys:
		active = key
	if not active and items:
		active = items[0]["key"]
	menu = _menu(next(i for i in items if i["key"] == active)) if active else None
	if settings.get("menu_style") == V14:
		return {**base, "style": "v14", "items": items, "active": active, "menu": menu, **_v14_landing()}
	return {**base, "style": "v16", "items": items, "active": active, "menu": menu}


@frappe.whitelist()
def get_menu(key: str):
	"""Sidebar of one dock icon."""
	settings = _settings()
	if not _enabled(settings):
		frappe.throw(_("Dock menu is not enabled for you"), frappe.PermissionError)
	item = next((i for i in _dock_items() if i["key"] == key), None)
	if not item:
		frappe.throw(_("Menu {0} is not available").format(key), frappe.PermissionError)
	return _menu(item)


@frappe.whitelist()
def get_submenu(workspace: str, own_only: int = 0):
	"""Menu of a sub-workspace, loaded when its entry is opened in the sidebar."""
	settings = _settings()
	if not _enabled(settings):
		frappe.throw(_("Dock menu is not enabled for you"), frappe.PermissionError)
	out = _submenu(workspace, bool(int(own_only or 0)))
	if out is None:
		frappe.throw(_("Menu {0} is not available").format(workspace), frappe.PermissionError)
	return out


@frappe.whitelist()
def get_search_index():
	"""Every link the user may open, across all dock icons and their sub-workspaces, for the sidebar search.

	[{label, route, icon, link_type, key (dock icon), app (its label), trail ([parent labels]),
	  chain ([sub-workspaces to open]), route_options, filters, new_tab}] — cached per user for 5 minutes."""
	settings = _settings()
	if not _enabled(settings):
		return []
	return _index()


def _index() -> list[dict]:
	ck = f"dock_menu_index::{frappe.session.user}::{_settings().get('menu_style')}"
	try:
		hit = frappe.cache.get_value(ck)
		if hit is not None:
			return hit
	except Exception:
		pass
	out, seen = [], set()
	for it in _dock_items():
		try:
			links = _all_links(_menu(it))
		except Exception:
			continue
		for l, chain in links:
			if l.get("group") or not l.get("route"):
				continue
			k = (it["key"], l["route"], l["label"])
			if k in seen:
				continue
			seen.add(k)
			row = {"label": l["label"], "route": l["route"], "icon": l.get("icon") or "", "link_type": l["link_type"],
				"key": it["key"], "app": it["label"], "trail": l.get("_trail") or [], "chain": list(chain)}
			for f in ("route_options", "filters", "new_tab"):
				if l.get(f):
					row[f] = l[f]
			out.append(row)
	try:
		frappe.cache.set_value(ck, out, expires_in_sec=300)
	except Exception:
		pass
	return out


@frappe.whitelist()
def locate(path: str):
	"""Dock icon to switch to for a page that is not in the current sidebar (None = keep)."""
	settings = _settings()
	if not _enabled(settings):
		return None
	return _locate(_dock_items(), path)


@frappe.whitelist()
def explain_v14_menu(user: str | None = None):
	"""System Manager: every workspace, whether the v14-style menu shows it to `user`, and why not.

	From the browser console: frappe.call("dock_menu.api.explain_v14_menu", {user: "x@y.com"}).then(r => console.table(r.message))
	"""
	frappe.only_for(MANAGER)
	me = frappe.session.user
	try:
		if user and user != me:
			frappe.set_user(user)
		for k in ("dock_menu_v14", "dock_menu_v14_rules", "dock_menu_groups", "dock_menu_ws", "dock_menu_can", "dock_menu_strict", "dock_menu_settings"):
			if hasattr(frappe.local, k):
				delattr(frappe.local, k)
		allowed = _frappe_allowed_workspaces()
		listed = {w["name"] for w in _v14_pages()}
		containers = {w["name"] for w in _v14_pages() if w.get("container")}
		scan = _v14_scan()
		for w in scan:
			if w["name"] in containers:
				w["shown"] = True
			elif w["shown"] and w["name"] not in listed:
				w["shown"], w["reason"] = False, "nothing on it this user can open"
		return [
			{
				"workspace": w["name"],
				"title": w["title"],
				"public": w["public"],
				"module": w.get("module"),
				"shown": int(w["shown"]),
				"reason": w["reason"] if w["name"] not in containers else "only as main menu of its sub-workspaces",
				"parent": _parent_of(w),
				"in_v16_boot": None if allowed is None else int(w["name"] in allowed),
			}
			for w in scan
		]
	finally:
		if frappe.session.user != me:
			frappe.set_user(me)


# ----------------------------------------------------------------------------- menu editor (System Manager)


def _can_edit() -> bool:
	"""Who may edit menus (Dock Menu Settings → Who can edit menus)."""
	if frappe.session.user == "Guest":
		return False
	if MANAGER in frappe.get_roles():
		return True
	return _settings().get("edit_access") == "All users" and _enabled(_settings())


def _editable(key):
	if not _can_edit():
		frappe.throw(_("You are not allowed to edit menus"), frappe.PermissionError)
	if not key:
		frappe.throw(_("Which menu?"))
	if not _table_ready(LAYOUT):
		frappe.throw(_("Run bench migrate to enable menu editing"))


@frappe.whitelist()
def get_layout(key: str):
	"""Rows for the sidebar editor: the saved layout, else the current automatic menu.

	key: a dock icon key, or "ws:<Workspace>" for a sub-workspace's menu."""
	_editable(key)
	mine, shared = _layout(key, "user"), _layout(key, "all")
	base = {"mine": int(bool(mine)), "shared": int(bool(shared)), "is_manager": int(MANAGER in frappe.get_roles())}
	lay = mine or shared
	if lay:
		rows = [{f: e.get(f) for f in ("entry_type", "label", "link_type", "link_to", "workspace", "url", "icon",
			"in_section", "hidden", "own_only", "collapsed", "new_tab")} for e in sorted(lay.entries, key=lambda r: r.idx)]
		return {**base, "exists": 1, "menu_title": lay.menu_title, "entries": rows}
	if key.startswith("ws:"):
		out = _auto_submenu(key[3:]) or []
		title = frappe.db.get_value("Workspace", key[3:], "title") or key[3:]
		return {**base, "exists": 0, "menu_title": title, "entries": _entries_of(out)}
	item = next((i for i in _dock_items() if i["key"] == key), None)
	if not item:
		frappe.throw(_("Menu {0} is not available").format(key))
	m = _auto_menu(item)
	return {**base, "exists": 0, "menu_title": m["title"], "entries": _entries_of(m["blocks"])}


@frappe.whitelist(methods=["POST"])
def save_layout(key: str, entries, menu_title: str | None = None, scope: str = "user"):
	"""Save the edited menu for the current user only (scope "user"), or, System Manager, for
	everyone who has not edited it themselves (scope "all"). Links stay permission-checked."""
	_editable(key)
	scope = "all" if scope == "all" else "user"
	if scope == "all":
		frappe.only_for(MANAGER)
	entries = frappe.parse_json(entries) or []
	name = _layout_name(key, scope)
	doc = frappe.get_doc(LAYOUT, name) if name else frappe.new_doc(LAYOUT)
	doc.menu_key = key
	if doc.meta.has_field("for_user"):
		doc.for_user = frappe.session.user if scope == "user" else None
	doc.menu_title = menu_title
	doc.set("entries", [])
	fields = ("entry_type", "label", "link_type", "link_to", "workspace", "url", "icon", "in_section", "hidden", "own_only", "collapsed", "new_tab")
	for r in entries:
		row = {f: r.get(f) for f in fields if r.get(f) not in (None, "")}
		if not row.get("entry_type"):
			continue
		doc.append("entries", row)
	doc.flags.ignore_permissions = True  # checked by _editable (Who can edit menus)
	doc.save()
	return doc.name


@frappe.whitelist(methods=["POST"])
def reset_layout(key: str, scope: str = "user"):
	"""Drop the user's own edits (back to the shared or automatic menu); System Manager, scope "all":
	drop the shared edits."""
	_editable(key)
	if scope == "all":
		frappe.only_for(MANAGER)
	name = _layout_name(key, "all" if scope == "all" else "user")
	if name:
		frappe.delete_doc(LAYOUT, name, ignore_permissions=True)
	for k in [k for k in _local_cache("dock_menu_layouts") if k[0] == key]:
		_local_cache("dock_menu_layouts").pop(k, None)
	try:
		frappe.cache.delete_value(f"dock_menu_index::{frappe.session.user}::{_settings().get('menu_style')}")
	except Exception:
		pass
	return 1


@frappe.whitelist()
def explain_submenu(workspace: str, user: str | None = None):
	"""System Manager: why a (sub-)workspace shows what it shows for `user`: its parent, whether the user
	may open it, its sub-workspaces, and every candidate link with the reason it is kept or dropped."""
	frappe.only_for(MANAGER)
	me = frappe.session.user
	try:
		if user and user != me:
			frappe.set_user(user)
		for k in ("dock_menu_v14", "dock_menu_v14_scan", "dock_menu_v14_rules", "dock_menu_groups", "dock_menu_ws",
			"dock_menu_can", "dock_menu_strict", "dock_menu_settings", "dock_menu_layouts", "dock_menu_custom_ws"):
			if hasattr(frappe.local, k):
				delattr(frappe.local, k)
		v14 = _is_v14()
		out = {"workspace": workspace, "user": frappe.session.user, "style": "v14" if v14 else "v16"}
		if not frappe.db.exists("Workspace", workspace):
			out["problem"] = "No Workspace with this name"
			return out
		w = frappe.db.get_value("Workspace", workspace, ["name", "title", "module", "public", "for_user", "parent_page", "is_hidden"], as_dict=True)
		w["title"] = w.title or w.name
		out["parent"] = _parent_of(w)
		out["custom"] = int(_is_custom_ws(w))
		out["can_open"] = int(_ws_allowed(workspace))
		if v14:
			scan = {x["name"]: x for x in _v14_scan()}
			out["reason_hidden"] = (scan.get(workspace) or {}).get("reason") or ("" if out["can_open"] else "nothing on it this user can open")
			page = next((p for p in _v14_pages() if p["name"] == workspace), None)
			out["sub_workspaces"] = [c["name"] for c in _v14_children(page)] if page else []
		out["edited_menu"] = int(bool(_layout("ws:" + workspace)))
		doc = frappe.get_doc("Workspace", workspace)
		src = _v14_source(doc)
		out["source"] = "own shortcuts/cards" if (doc.get("shortcuts") or doc.get("links")) else ("v14 menu shipped with dock_menu" if src is not doc else "none on the page")
		sb = _find_sidebar({"sidebar": None}, w)
		out["workspace_sidebar"] = sb.name if sb else None
		rows = []
		def check(label, lt, to, origin):
			t = (lt or "").lower()
			ok = _v14_allowed(to, t) if v14 else _permitted(t, to)
			why = "" if ok else ("does not exist" if t in ("doctype", "report", "page", "dashboard") and not frappe.db.exists({"doctype": "DocType", "report": "Report", "page": "Page", "dashboard": "Dashboard"}[t], to) else "no permission")
			rows.append({"origin": origin, "label": label, "type": lt, "link_to": to, "shown": int(bool(ok)), "why_not": why})
		for sc in src.get("shortcuts") or []:
			check(sc.get("label"), sc.get("type"), sc.get("link_to"), "shortcut")
		for l in src.get("links") or []:
			if l.get("type") != "Card Break":
				check(l.get("label"), l.get("link_type"), l.get("link_to"), "card")
		if sb:
			for r in sb.get("items") or []:
				if (r.get("type") or "Link") == "Link":
					check(r.get("label"), r.get("link_type") or "DocType", r.get("link_to") or r.get("url"), "sidebar " + sb.name)
		out["links"] = rows
		out["menu"] = [{"label": e.get("label"), "sub_workspace": int(bool(e.get("lazy"))), "items": len(e.get("children") or [])}
			for e in (_submenu(workspace) or [])]
		return out
	finally:
		if frappe.session.user != me:
			frappe.set_user(me)


def extend_bootinfo(bootinfo):
	"""Boot: where the desk opens instead of the v16 apps page (and, v14 style, the workspaces to register
	with the router), so the client can redirect before the apps page is drawn."""
	try:
		settings = _settings()
		if not _enabled(settings):
			if bootinfo.get("home_page") == "dock-home":
				bootinfo["home_page"] = "desktop"  # the dock is off for this user
			return
		home = (settings.get("home_route") or "/desk").rstrip("/")
		if not settings.get("open_workspace_on_desk") or home not in ("", "/desk", "/app"):
			bootinfo.dock_menu = {"enabled": 1, "landing": []}
			return
		if settings.get("landing_page") != "Last used workspace":
			# /desk draws bootinfo.home_page (v16: the apps page "desktop"): make it the Home page
			if frappe.db.exists("Page", "dock-home"):
				bootinfo["home_page"] = "dock-home"
			bootinfo.dock_menu = {"enabled": 1, "style": "v14" if _is_v14() else "v16", "landing": [{"name": "__home", "route": HOME_PAGE}],
				"register": _v14_landing()["register"] if _is_v14() else [], "home_page": "dock-home"}
		elif _is_v14():
			v = _v14_landing()
			bootinfo.dock_menu = {"enabled": 1, "style": "v14", "landing": v["landing"], "register": v["register"]}
		else:
			bootinfo.dock_menu = {"enabled": 1, "style": "v16",
				"landing": [{"name": i["key"], "route": i["route"]} for i in _dock_items() if i.get("route")]}
	except Exception:
		frappe.log_error(title="dock_menu boot")


HOME_PAGE = "/desk/dock-home"


@frappe.whitelist()
def get_home():
	"""Data for the Home page: one card per dock icon the user may open, with its first links and sub-workspaces."""
	settings = _settings()
	if not _enabled(settings):
		return {"enabled": 0}
	full = frappe.db.get_value("User", frappe.session.user, "full_name") or frappe.session.user
	cards = []
	for it in _dock_items():
		try:
			m = _menu(it)
		except Exception:
			continue
		links, subs, count = [], [], 0

		def take(l, section=None):
			nonlocal count
			if l.get("lazy") or (l.get("link_type") == "workspace" and l.get("children")):
				subs.append({"label": l["label"], "route": l.get("route"), "ws": l.get("ws") or l.get("link_to"), "icon": l.get("icon") or ""})
				return
			if l.get("group"):
				for k in l.get("children") or []:
					take(k, l["label"])
				return
			if not l.get("route"):
				return
			count += 1
			if len(links) < 6 and l.get("link_type") != "url":
				row = {"label": l["label"], "route": l["route"], "link_type": l["link_type"], "link_to": l.get("link_to"), "url": l.get("url"),
					"icon": l.get("icon") or "", "section": section or ""}
				for f in ("route_options", "filters"):
					if l.get(f):
						row[f] = l[f]
				links.append(row)

		for b in m["blocks"]:
			if b["type"] == "link":
				take(b)
			elif b["type"] == "section":
				for l in b["items"]:
					take(l, b["label"])
		if not (links or subs):
			continue
		cards.append({k: it.get(k) for k in ("key", "label", "icon", "abbr", "color", "image", "route")}
			| {"links": links, "subs": subs[:8], "more_subs": max(0, len(subs) - 8), "count": count})
	return {"enabled": 1, "full_name": full, "first_name": full.split(" ")[0], "subtitle": _subtitle(settings), "cards": cards,
		"is_manager": int(MANAGER in frappe.get_roles()), "can_edit": int(_can_edit())}



def sync_home_default(settings_doc=None):
	"""Make the desk's home page (site default "desktop:home_page", what /desk draws) the dock Home page
	while Dock Menu Settings say so, and give the v16 apps page back otherwise. Runs after migrate
	and when the settings are saved; a home page set to anything else by someone is left alone."""
	try:
		s = _read_settings()
		if settings_doc is not None:  # just saved: use its values, not a cached copy
			for k in DEFAULTS:
				v = settings_doc.get(k)
				if v is not None and v != "":
					s[k] = v
		want = "dock-home" if (s.get("enabled") and s.get("open_workspace_on_desk") and s.get("landing_page") != "Last used workspace"
			and (s.get("home_route") or "/desk").rstrip("/") in ("", "/desk", "/app") and frappe.db.exists("Page", "dock-home")) else "desktop"
		cur = frappe.db.get_default("desktop:home_page")
		if cur in (None, "", "desktop", "dock-home", "workspace") and cur != want:
			frappe.db.set_default("desktop:home_page", want)
			frappe.clear_cache()
	except Exception:
		frappe.log_error(title="dock_menu home page")



@frappe.whitelist()
def home_target():
	"""Where the v16 apps page should send this user instead (used by the apps page itself, see
	public/js/desktop_redirect.js): {"enabled": 1, "landing": [{name, route}], ...} or {"enabled": 0}."""
	info = frappe._dict()
	extend_bootinfo(info)
	return info.get("dock_menu") or {"enabled": 0}


@frappe.whitelist()
def debug_home():
	"""Why /desk does or does not open the Home page for the current user (open
	/api/method/dock_menu.api.debug_home in the browser)."""
	s = _read_settings()
	out = {
		"user": frappe.session.user,
		"user_type": frappe.db.get_value("User", frappe.session.user, "user_type"),
		"dock_enabled_for_user": _enabled(_settings()),
		"settings": {k: s.get(k) for k in ("enabled", "apply_to_system_managers", "open_workspace_on_desk", "landing_page", "home_route", "menu_style")},
		"page_dock_home_exists": bool(frappe.db.exists("Page", "dock-home")),
		"site_default_desktop_home_page": frappe.db.get_default("desktop:home_page"),
		"user_default_workspace": (frappe.get_user().load_user().get("default_workspace") or {}).get("name") if hasattr(frappe.get_user(), "load_user") else None,
		"login_home_page": None,
		"hooks_boot_session": frappe.get_hooks("boot_session"),
		"home_target": home_target(),
	}
	try:
		from frappe.website.utils import get_home_page

		out["login_home_page"] = get_home_page()
	except Exception as e:
		out["login_home_page"] = f"error: {e}"
	try:
		import frappe.desk.desk_page

		frappe.desk.desk_page.get("dock-home")
		out["page_dock_home_permitted"] = True
	except Exception as e:
		out["page_dock_home_permitted"] = f"no: {e}"
	out["recent_errors"] = frappe.get_all("Error Log", filters={"method": ["like", "dock_menu%"]}, fields=["method", "creation"], order_by="creation desc", limit=5)
	return out



@frappe.whitelist(methods=["POST"])
def quick_edit(key: str, action: str, link_type: str | None = None, link_to: str | None = None,
	label: str | None = None, url: str | None = None, section: str | None = None, workspace: str | None = None):
	"""One change to a menu from the Home page (System Manager): add / rename / delete a link or
	sub-workspace. The menu becomes an edited one (Dock Menu Layout) starting from what it shows now.

	action: "add" (link_type + link_to, or workspace for a sub-workspace; optional label, section),
	"rename" (link_type + link_to + label), "delete" (link_type + link_to)."""
	_editable(key)
	cur = get_layout(key)
	rows = cur["entries"]
	lt_name = TYPE_NAME.get((link_type or "").lower(), link_type or "")

	def same(r):
		if (link_type or "").lower() == "workspace" or (r.get("entry_type") == "Sub-workspace" and not link_type):
			return r.get("entry_type") == "Sub-workspace" and r.get("workspace") == (workspace or link_to) or (
				r.get("entry_type") == "Link" and r.get("link_type") == "Workspace" and r.get("link_to") == (workspace or link_to))
		if r.get("entry_type") != "Link":
			return False
		if lt_name == "URL":
			return r.get("link_type") == "URL" and (r.get("url") == (url or link_to) or r.get("link_to") == link_to)
		return r.get("link_type") == lt_name and r.get("link_to") == link_to

	if action == "add":
		if workspace:
			if not frappe.db.exists("Workspace", workspace):
				frappe.throw(_("Workspace {0} not found").format(workspace))
			new = {"entry_type": "Sub-workspace", "workspace": workspace, "label": label or "", "in_section": 0}
		else:
			if lt_name not in TYPE_OF or not (link_to or url):
				frappe.throw(_("Choose what the link opens"))
			if lt_name != "URL" and not frappe.db.exists(lt_name, link_to):
				frappe.throw(_("{0} {1} not found").format(_(lt_name), link_to))
			new = {"entry_type": "Link", "link_type": lt_name, "link_to": link_to if lt_name != "URL" else "",
				"url": (url or link_to) if lt_name == "URL" else "", "label": label or "", "in_section": 0}
		if section:
			# into that section (created at the end if missing)
			idx = next((i for i, r in enumerate(rows) if r.get("entry_type") == "Section" and (r.get("label") or "") == section), None)
			if idx is None:
				rows.append({"entry_type": "Section", "label": section})
				rows.append({**new, "in_section": 1})
			else:
				end = idx + 1
				while end < len(rows) and rows[end].get("entry_type") not in ("Section", "Spacer") and rows[end].get("in_section"):
					end += 1
				rows.insert(end, {**new, "in_section": 1})
		else:
			# top-level links come before the first section
			first_sec = next((i for i, r in enumerate(rows) if r.get("entry_type") == "Section"), len(rows))
			rows.insert(first_sec, new)
	elif action in ("rename", "delete"):
		hit = next((r for r in rows if same(r)), None)
		if not hit:
			frappe.throw(_("That entry is not in this menu"))
		if action == "delete":
			rows.remove(hit)
		else:
			if not label:
				frappe.throw(_("Enter a label"))
			hit["label"] = label
	else:
		frappe.throw(_("Unknown action {0}").format(action))
	save_layout(key, rows, cur.get("menu_title"), "user")  # only this user's menu changes
	return 1


@frappe.whitelist()
def workspace_menu_keys():
	"""Workspaces that can be added as a sub-workspace (name, title)."""
	if not _can_edit():
		frappe.throw(_("You are not allowed to edit menus"), frappe.PermissionError)
	return frappe.get_all("Workspace", filters={"public": 1}, fields=["name", "title"], order_by="title asc")


# headings for a workspace page: each link is filed under its module's heading
MODULE_HEADING = {
	# ERPNext / HRMS modules keep their own names; Frappe framework modules go under "General"
	"Core": "General", "Desk": "General", "Automation": "General", "Website": "General", "Integrations": "General",
	"Email": "General", "Printing": "General", "Contacts": "General", "Custom": "General", "Social": "General",
	"Geo": "General", "Workflow": "General", "Utilities": "General",
}


@frappe.whitelist()
def get_link_modules(links: str | list):
	"""{"<link_type>:<link_to>": heading} for [[link_type, link_to], ...].
	A report goes under its reference DocType's module (so a custom report on Sales Order sits under Selling)."""
	if isinstance(links, str):
		links = json.loads(links or "[]")
	out, dt_mod = {}, {}

	def module_of_doctype(dt):
		if dt not in dt_mod:
			dt_mod[dt] = frappe.db.get_value("DocType", dt, "module") if dt else None
		return dt_mod[dt]

	for lt, to in links[:500]:
		lt, mod = (lt or "").lower(), None
		try:
			if lt == "doctype":
				mod = module_of_doctype(to)
			elif lt == "report":
				ref, rmod = frappe.db.get_value("Report", to, ["ref_doctype", "module"]) or (None, None)
				mod = module_of_doctype(ref) or rmod
			elif lt == "page":
				mod = frappe.db.get_value("Page", to, "module")
			elif lt == "dashboard":
				mod = frappe.db.get_value("Dashboard", to, "module")
		except Exception:
			mod = None
		out[f"{lt}:{to}"] = _(MODULE_HEADING.get(mod) or mod or "General")
	return out


@frappe.whitelist()
def get_workspace_layout(workspace: str):
	"""A workspace page's own content for the dock's workspace page, as the page draws it: shortcuts in page
	order, each tagged with the page heading above it ("head"), then the link cards (with the heading above the
	first card as "cards_head"). Permission-filtered; read straight from the Workspace, so a Workspace Sidebar
	or a saved menu layout does not hide it. Empty when the page has neither shortcuts nor cards."""
	import html
	import re

	if not workspace or not frappe.db.exists("Workspace", workspace):
		return {}
	ws = _allowed_workspaces().get(workspace)
	if not ws and _is_v14():
		ws = next((w for w in _v14_pages() if w["name"] == workspace and not w.get("container")), None)
	if not ws:
		return {}
	doc = frappe.get_doc("Workspace", workspace)
	try:
		content = json.loads(doc.get("content") or "[]")
	except Exception:
		content = []
	# a dashboard page (charts / number cards / custom blocks, no link cards) opens as it is
	kinds = {b.get("type") for b in content}
	if kinds & {"chart", "number_card", "custom_block"} and "card" not in kinds:
		return {"dashboard": 1, "route": _ws_route(ws)}
	order, heads, head, cards_head = {}, {}, None, None
	for b in content:
		t, d = b.get("type"), b.get("data") or {}
		if t == "header":
			head = html.unescape(re.sub(r"<[^>]+>", "", d.get("text") or "")).strip() or None
		elif t == "shortcut" and d.get("shortcut_name") not in order:
			order[d.get("shortcut_name")] = len(order)
			heads[d.get("shortcut_name")] = head
		elif t == "card" and cards_head is None:
			cards_head = head
	rows = list(doc.get("shortcuts") or [])
	if order:  # the page shows only the shortcuts placed in its content, in that order
		rows = sorted((s for s in rows if s.get("label") in order), key=lambda s: order[s.get("label")])
	shortcuts = []
	for s in rows:
		lt = (s.get("type") or "").lower()
		link = _link(s.get("label"), lt, s.get("link_to"), icon=s.get("icon"), url=s.get("url"),
			doc_view=s.get("doc_view") if lt == "doctype" else None)
		if link:
			if heads.get(s.get("label")):
				link["head"] = _(heads[s.get("label")])
			shortcuts.append(link)
	cards, card = [], None
	for l in doc.get("links") or []:
		if l.get("type") == "Card Break":
			card = {"type": "section", "label": _(l.get("label") or ""), "icon": l.get("icon") or "", "collapsible": 1,
				"keep_closed": 0, "items": []}
			if not l.get("hidden"):
				cards.append(card)
			continue
		if card is None or l.get("hidden"):
			continue
		link = _link(_(l.get("label") or l.get("link_to")), l.get("link_type"), l.get("link_to"), icon=l.get("icon"))
		if link:
			card["items"].append(link)
	cards = [c for c in cards if c["items"]]
	if not shortcuts and not cards:
		return {}
	return {"title": _(doc.get("title") or doc.name), "blocks": shortcuts + cards,
		"cards_head": _(cards_head) if cards_head else None}


def load_app_workspaces():
	"""after_install / after_migrate: (re)load the workspaces shipped with this app (Operations)."""
	folder = os.path.join(os.path.dirname(__file__), "dock_menu", "workspace")
	if not os.path.isdir(folder):
		return
	for name in sorted(os.listdir(folder)):
		if os.path.isfile(os.path.join(folder, name, name + ".json")):
			try:
				frappe.reload_doc("dock_menu", "workspace", name, force=True)
			except Exception:
				frappe.log_error(title=f"dock_menu: could not load workspace {name}")
	frappe.clear_cache()
