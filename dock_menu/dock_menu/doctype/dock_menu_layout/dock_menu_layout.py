import frappe
from frappe.model.document import Document


class DockMenuLayout(Document):
	def validate(self):
		for e in self.entries:
			if e.entry_type == "Link" and not (e.link_to or e.url):
				frappe.throw(frappe._("Row {0}: a link needs Link To or URL").format(e.idx))
			if e.entry_type == "Sub-workspace" and not e.workspace:
				frappe.throw(frappe._("Row {0}: choose the workspace").format(e.idx))
			if e.entry_type == "Section" and not e.label:
				frappe.throw(frappe._("Row {0}: a section needs a label").format(e.idx))

	def on_update(self):
		_clear()

	def on_trash(self):
		_clear()


def _clear():
	try:
		frappe.cache.delete_keys("dock_menu_index::")
	except Exception:
		pass
