import frappe


def execute():
	"""Show 10 icons in the dock before "More" (was 7)."""
	if not frappe.db.exists("DocType", "Dock Menu Settings"):
		return
	cur = frappe.db.get_single_value("Dock Menu Settings", "dock_limit")
	if not cur or int(cur) == 7:
		frappe.db.set_single_value("Dock Menu Settings", "dock_limit", 10)
