/** @odoo-module */
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { Component, onWillStart, useState } from "@odoo/owl";

export class SupervisorDashboard extends Component {
    setup() {
        this.orm = useService("orm");
        this.action = useService("action");
        this.notification = useService("notification");

        this.state = useState({
            shiftFirst: [],
            shiftSecond: [],
            shiftBoth: [],
            unassignedData: null,
            activeTab: 'overview',
            newSup: {
                name: '',
                job_title: 'Production Supervisor',
                work_email: '',
                work_phone: '',
                drs_shift: 'first' // Added default shift
            }
        });

        onWillStart(async () => {
            await this.fetchData();
        });
    }

    async fetchData() {
        // Fetch employees and include their assigned shift
        const employees = await this.orm.searchRead(
            "hr.employee",
            [["is_drs_supervisor", "=", true]],
            ["id", "name", "drs_shift"]
        );

        let supMap = {};
        for (let emp of employees) {
            supMap[emp.id] = {
                id: emp.id,
                name: emp.name,
                shift: emp.drs_shift || 'both', // default to both if missing
                m311: { weight: 0, rolls: 0 },
                m312: { weight: 0, rolls: 0 },
                totalWeight: 0,
                totalRolls: 0
            };
        }

        const result = await this.orm.readGroup(
            "mrp.drs.production",
            [],
            ["supervisor_id", "machine_number", "final_weight:sum", "length:sum"],
            ["supervisor_id", "machine_number"],
            { lazy: false }
        );

        let hasUnassigned = false;
        let unassignedData = {
            id: 0,
            name: 'Unassigned Work Logs',
            m311: { weight: 0, rolls: 0 },
            m312: { weight: 0, rolls: 0 },
            totalWeight: 0,
            totalRolls: 0
        };

        for (let r of result) {
            let supId = r.supervisor_id ? r.supervisor_id[0] : 0;
            let weight = r.final_weight || 0;
            let rolls = r.__count || 0;

            if (supId === 0) {
                hasUnassigned = true;
                unassignedData.totalWeight += weight;
                unassignedData.totalRolls += rolls;
                if (r.machine_number === '311') {
                    unassignedData.m311.weight += weight;
                    unassignedData.m311.rolls += rolls;
                } else if (r.machine_number === '312') {
                    unassignedData.m312.weight += weight;
                    unassignedData.m312.rolls += rolls;
                }
            } else if (supMap[supId]) {
                supMap[supId].totalWeight += weight;
                supMap[supId].totalRolls += rolls;

                if (r.machine_number === '311') {
                    supMap[supId].m311.weight += weight;
                    supMap[supId].m311.rolls += rolls;
                } else if (r.machine_number === '312') {
                    supMap[supId].m312.weight += weight;
                    supMap[supId].m312.rolls += rolls;
                }
            }
        }

        // Group into distinct arrays based on the shift
        let first = [], second = [], both = [];

        Object.values(supMap).forEach(sup => {
            sup.totalWeight = Math.round(sup.totalWeight * 100) / 100;
            if (sup.shift === 'first') first.push(sup);
            else if (sup.shift === 'second') second.push(sup);
            else both.push(sup);
        });

        const sortFunc = (a, b) => b.totalWeight - a.totalWeight || a.name.localeCompare(b.name);

        this.state.shiftFirst = first.sort(sortFunc);
        this.state.shiftSecond = second.sort(sortFunc);
        this.state.shiftBoth = both.sort(sortFunc);
        this.state.unassignedData = hasUnassigned ? unassignedData : null;
    }

    setTab(tabName) {
        this.state.activeTab = tabName;
    }

    async createSupervisor(ev) {
        ev.preventDefault();

        if (!this.state.newSup.name) {
            this.notification.add("Supervisor Name is required.", { type: "danger" });
            return;
        }

        try {
            await this.orm.create("hr.employee", [{
                name: this.state.newSup.name,
                job_title: this.state.newSup.job_title,
                work_email: this.state.newSup.work_email,
                work_phone: this.state.newSup.work_phone,
                drs_shift: this.state.newSup.drs_shift, // Save the selected shift
                is_drs_supervisor: true
            }]);

            this.notification.add("New Supervisor added successfully!", { type: "success" });
            this.state.newSup = { name: '', job_title: 'Production Supervisor', work_email: '', work_phone: '', drs_shift: 'first' };

            await this.fetchData();
            this.state.activeTab = 'overview';

        } catch (error) {
            this.notification.add("An error occurred while creating the supervisor.", { type: "danger" });
        }
    }

    openEmployeeDirectory() {
        this.action.doAction({
            type: 'ir.actions.act_window',
            name: 'Manage Supervisors',
            res_model: 'hr.employee',
            views: [[false, 'kanban'], [false, 'list'], [false, 'form']],
            domain: [['is_drs_supervisor', '=', true]],
            context: { default_is_drs_supervisor: true }
        });
    }

    openSupervisorWork(supervisorId) {
        let domain = supervisorId ? [['supervisor_id', '=', supervisorId]] : [['supervisor_id', '=', false]];
        this.action.doAction({
            type: 'ir.actions.act_window',
            name: 'Supervisor Production Reports',
            res_model: 'mrp.drs.production',
            views: [[false, 'list'], [false, 'form']],
            domain: domain,
        });
    }
}

SupervisorDashboard.template = "mrp_drs_production.SupervisorDashboardTemplate";
registry.category("actions").add("drs_supervisor_dashboard_action", SupervisorDashboard);