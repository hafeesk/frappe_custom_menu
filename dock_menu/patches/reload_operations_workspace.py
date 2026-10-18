import frappe


def execute():
	"""Reload the Operations workspace from the app (shortcuts + Reports & Masters cards),
	even when the copy in the database was saved later."""
	frappe.reload_doc("dock_menu", "workspace", "operations", force=True)
	frappe.clear_cache()
