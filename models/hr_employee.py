from odoo import models, fields


class HrEmployee(models.Model):
    _inherit = 'hr.employee'

    is_drs_supervisor = fields.Boolean(string="DRS Supervisor (مشرف)", default=False)
    is_drs_technician = fields.Boolean(string="DRS Technician (فني)", default=False)
    drs_shift = fields.Selection([
        ('first', 'First Shift (أولي)'),
        ('second', 'Second Shift (ثانية)'),
        ('both', 'Both Shifts (الورديتين)')
    ], string="DRS Shift (الوردية)")
