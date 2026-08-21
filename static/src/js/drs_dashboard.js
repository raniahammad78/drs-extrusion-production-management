/** @odoo-module */
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { loadJS } from "@web/core/assets";
import { Component, onWillStart, onMounted, onWillUnmount, useRef, useState } from "@odoo/owl";
import { session } from "@web/session"; // Added session import

export class DrsDashboard extends Component {
    setup() {
        this.orm = useService("orm");
        this.action = useService("action");
        this.notification = useService("notification");

        this.trendRef = useRef("trendChart");
        this.shiftRef = useRef("shiftChart");
        this.qualityRef = useRef("qualityChart");
        this.charts = {};
        this.refreshInterval = null;
        this.visibilityHandler = this.handleVisibilityChange.bind(this);

        this.state = useState({
            initialLoad: true,
            lastUpdated: null,
            filters: { quickRange: "today", dateFrom: "", dateTo: "", machine: "all", shift: "all", supervisorId: "all" },
            supervisorOptions: [],
            kpi: {
                totalWeight: 0, totalRolls: 0, totalLength: 0, avgWeight: 0,
                activeMachines: 0, qualityScore: 100,
                avgSprayWeight: 0, reportedFaults: 0, avgLineSpeed: 0,
                trends: { production: 0, quality: 0, machines: 0, avgWeight: 0 }
            },
            trend: [],
            shiftBreakdown: [],
            machineList: [],
            recent: [],
            qualityByZone: [],
            activeAlerts: [],
            hasData: false
        });

        onWillStart(async () => {
            await loadJS("/web/static/lib/Chart/Chart.js");
            await this.fetchSupervisorOptions();
            await this.fetchDashboardData();
        });

        onMounted(() => {
            this.renderCharts();
            this.startAutoRefresh();
            document.addEventListener("visibilitychange", this.visibilityHandler);
        });

        onWillUnmount(() => {
            if (this.refreshInterval) clearInterval(this.refreshInterval);
            document.removeEventListener("visibilitychange", this.visibilityHandler);
            Object.values(this.charts).forEach((c) => c && c.destroy());
        });
    }

    startAutoRefresh() {
        if (this.refreshInterval) clearInterval(this.refreshInterval);
        this.refreshInterval = setInterval(() => {
            if (!document.hidden) {
                this.fetchDashboardData();
            }
        }, 15000);
    }

    handleVisibilityChange() {
        if (document.hidden) {
            clearInterval(this.refreshInterval);
        } else {
            this.fetchDashboardData();
            this.startAutoRefresh();
        }
    }

    async fetchSupervisorOptions() {
        try {
            const sups = await this.orm.searchRead("hr.employee", [["is_drs_supervisor", "=", true]], ["id", "name"]);
            this.state.supervisorOptions = sups.map(s => ({ id: s.id, name: s.name }));
        } catch (e) {
            this.state.supervisorOptions = [];
        }
    }

    buildDomain() {
        let domain = [];
        if (this.state.filters.quickRange === "today" && !this.state.filters.dateFrom) {
            const today = new Date().toISOString().slice(0, 10);
            domain.push(['date', '=', today]);
        } else {
            if (this.state.filters.dateFrom) domain.push(['date', '>=', this.state.filters.dateFrom]);
            if (this.state.filters.dateTo) domain.push(['date', '<=', this.state.filters.dateTo]);
        }
        if (this.state.filters.machine && this.state.filters.machine !== "all") domain.push(['machine_number', '=', this.state.filters.machine]);
        if (this.state.filters.shift && this.state.filters.shift !== "all") domain.push(['shift', '=', this.state.filters.shift]);
        if (this.state.filters.supervisorId && this.state.filters.supervisorId !== "all") domain.push(['supervisor_id', '=', parseInt(this.state.filters.supervisorId, 10)]);
        return domain;
    }

    async fetchDashboardData() {
        const domain = this.buildDomain();

        const aggregates = await this.orm.readGroup(
            "mrp.drs.production",
            domain,
            ["final_weight:sum", "length:sum", "average_spray_weight:avg", "line_speed:avg"],
            []
        );

        const totals = aggregates.length > 0 ? aggregates[0] : { final_weight: 0, length: 0, average_spray_weight: 0, line_speed: 0, __count: 0 };
        this.state.hasData = totals.__count > 0;

        const machineGroups = await this.orm.readGroup(
            "mrp.drs.production", domain, ["final_weight:sum"], ["machine_number"]
        );

        this.state.machineList = machineGroups.map(g => ({
            name: g.machine_number,
            weight: Math.round((g.final_weight || 0) * 100) / 100,
            hasAlert: false
        }));

        const shiftGroups = await this.orm.readGroup(
            "mrp.drs.production", domain, ["final_weight:sum"], ["shift"]
        );

        this.state.shiftBreakdown = shiftGroups.map(g => ({
            label: g.shift === 'first' ? 'First Shift' : (g.shift === 'second' ? 'Second Shift' : 'Unknown'),
            weight: Math.round((g.final_weight || 0) * 100) / 100
        }));

        const trendGroups = await this.orm.readGroup(
            "mrp.drs.production", domain, ["final_weight:sum"], ["date:day"]
        );

        this.state.trend = trendGroups.map(g => ({
            label: g['date:day'],
            weight: Math.round((g.final_weight || 0) * 100) / 100
        }));

        const recentRecords = await this.orm.searchRead(
            "mrp.drs.production", domain,
            ["final_weight", "machine_number", "date", "notes", "id", "supervisor_id"],
            { order: 'date desc, id desc', limit: 50 }
        );

        let faultCount = recentRecords.filter(r => r.notes && r.notes.trim() !== '').length;

        const sumWeight = Math.round((totals.final_weight || 0) * 100) / 100;
        const currentAvgWeight = totals.__count > 0 ? Math.round((sumWeight / totals.__count) * 10) / 10 : 0;

        let qualityScore = 100;
        this.state.qualityByZone = [];

        if (recentRecords.length > 0) {
            const recordIds = recentRecords.map(r => r.id);
            try {
                const lines = await this.orm.searchRead(
                    "mrp.drs.extrusion.line", [["production_id", "in", recordIds]], ["zone", "set_temperature", "actual_temperature"]
                );

                const zoneMap = {};
                let totalAbsDev = 0, devCount = 0;

                for (const l of lines) {
                    if (!l.zone) continue;
                    const setT = l.set_temperature || 0;
                    const actT = l.actual_temperature || 0;

                    if (!zoneMap[l.zone]) zoneMap[l.zone] = { set: 0, actual: 0, n: 0 };
                    zoneMap[l.zone].set += setT;
                    zoneMap[l.zone].actual += actT;
                    zoneMap[l.zone].n += 1;

                    if (setT > 0) {
                        const diff = Math.abs(actT - setT);
                        totalAbsDev += diff;
                        devCount += 1;
                    }
                }

                const zoneOrder = ["zone1", "zone2", "zone3", "zone4", "zone5"];
                this.state.qualityByZone = zoneOrder.filter(z => zoneMap[z]).map(z => ({
                    label: z.replace("zone", "Zone "),
                    setTemp: Math.round((zoneMap[z].set / zoneMap[z].n) * 10) / 10,
                    actualTemp: Math.round((zoneMap[z].actual / zoneMap[z].n) * 10) / 10,
                }));

                if (devCount > 0) {
                    qualityScore = Math.max(0, Math.round(100 - ((totalAbsDev / devCount) / 5) * 100));
                }
            } catch (err) {}
        }

        this.state.kpi = {
            totalWeight: sumWeight,
            totalRolls: totals.__count,
            totalLength: Math.round((totals.length || 0) * 100) / 100,
            avgWeight: currentAvgWeight,
            activeMachines: machineGroups.length,
            qualityScore: qualityScore,
            avgSprayWeight: Math.round((totals.average_spray_weight || 0) * 10) / 10,
            avgLineSpeed: Math.round((totals.line_speed || 0) * 10) / 10,
            reportedFaults: faultCount,
            trends: {
                production: sumWeight > 0 ? 100 : 0,
                quality: qualityScore >= 90 ? 10 : -10,
                machines: machineGroups.length > 0 ? 10 : 0,
                avgWeight: currentAvgWeight > 0 ? 5 : 0
            }
        };

        this.state.activeAlerts = faultCount > 0 ? [`${faultCount} recent logs contain active operational fault notes.`] : [];
        this.state.recent = recentRecords.slice(0, 5);

        const now = new Date();
        this.state.lastUpdated = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        this.state.initialLoad = false;

        this.renderCharts();
    }

    setQuickRange(range) {
        this.state.filters.quickRange = range;
        const today = new Date().toISOString().slice(0, 10);
        if (range === "today") {
            this.state.filters.dateFrom = ""; this.state.filters.dateTo = "";
        } else if (range === "week") {
            const d = new Date(); d.setDate(d.getDate() - 6);
            this.state.filters.dateFrom = d.toISOString().slice(0, 10); this.state.filters.dateTo = today;
        } else if (range === "month") {
            const d = new Date(); d.setDate(1);
            this.state.filters.dateFrom = d.toISOString().slice(0, 10); this.state.filters.dateTo = today;
        } else {
            this.state.filters.dateFrom = ""; this.state.filters.dateTo = "";
        }
        this.fetchDashboardData();
    }

    onFilterChange(field, ev) {
        this.state.filters[field] = ev.target.value;
        if (field === "dateFrom" || field === "dateTo") this.state.filters.quickRange = "custom";
        this.fetchDashboardData();
    }

    resetFilters() {
        this.state.filters = { quickRange: "today", dateFrom: "", dateTo: "", machine: "all", shift: "all", supervisorId: "all" };
        this.fetchDashboardData();
    }

    renderCharts() {
        if (!window.Chart || !this.state.hasData) return;

        Object.values(this.charts).forEach(c => c && c.destroy());

        if (this.trendRef.el) {
            this.charts.trend = new window.Chart(this.trendRef.el.getContext("2d"), {
                type: "line",
                data: {
                    labels: this.state.trend.map(t => t.label),
                    datasets: [{
                        label: "Output (kg)", data: this.state.trend.map(t => t.weight),
                        borderColor: "#7c3aed", backgroundColor: "rgba(124, 58, 237, 0.08)", fill: true, tension: 0.4
                    }]
                },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
            });
        }

        if (this.shiftRef.el) {
            this.charts.shift = new window.Chart(this.shiftRef.el.getContext("2d"), {
                type: "bar",
                data: {
                    labels: this.state.shiftBreakdown.map(s => s.label),
                    datasets: [{
                        data: this.state.shiftBreakdown.map(s => s.weight),
                        backgroundColor: ["#7c3aed", "#06b6d4"], borderRadius: 6
                    }]
                },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
            });
        }

        if (this.qualityRef.el) {
            this.charts.quality = new window.Chart(this.qualityRef.el.getContext("2d"), {
                type: "bar",
                data: {
                    labels: this.state.qualityByZone.map(z => z.label),
                    datasets: [
                        { label: "Set Temp", data: this.state.qualityByZone.map(z => z.setTemp), backgroundColor: "#cbd5e1" },
                        { label: "Actual Temp", data: this.state.qualityByZone.map(z => z.actualTemp), backgroundColor: "#10b981" }
                    ]
                },
                options: { responsive: true, maintainAspectRatio: false }
            });
        }
    }

    openDiscuss() {
        this.action.doAction("mail.action_discuss");
    }

    showNotification() {
        this.notification.add("You have no new critical machine alerts at this time.", { type: "info" });
    }

    openMyProfile() {
        this.action.doAction({
            type: "ir.actions.act_window",
            res_model: "res.users",
            res_id: session.uid, // Safely pulls the current logged-in user ID via Odoo session
            views: [[false, "form"]],
            target: "new"
        });
    }

    openFilteredWork(extraDomain, title, targetModel = "mrp.drs.production") {
        let finalDomain = [];
        if (targetModel === "mrp.drs.production") {
            finalDomain = this.buildDomain().concat(extraDomain || []);
        } else {
            finalDomain = extraDomain || [];
        }

        this.action.doAction({
            type: "ir.actions.act_window",
            name: title || "Records",
            res_model: targetModel,
            views: [[false, "list"], [false, "form"]],
            domain: finalDomain
        });
    }

    openRecord(id) {
        this.action.doAction({ type: "ir.actions.act_window", res_model: "mrp.drs.production", views: [[false, "form"]], res_id: id });
    }
}
DrsDashboard.template = "mrp_drs_production.DashboardTemplate";
registry.category("actions").add("drs_dashboard_action", DrsDashboard);