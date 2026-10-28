// ============================================================
//  ViagemControl - Aplicação de Gestão de Gastos e Entradas
// ============================================================

(function () {
    'use strict';

    // ===== Storage Keys =====
    const TRIPS_KEY = 'viagemcontrol_trips_v2';
    const INCOMES_KEY = 'viagemcontrol_incomes_v2';
    const SETTINGS_KEY = 'viagemcontrol_settings_v2';

    // ===== Default Settings =====
    const DEFAULT_SETTINGS = {
        carModel: '',
        kmPerLiter: 11.5,
        fuelType: 'Gasolina',
        fuelPrice: 5.89,
        defaultOrigin: '',
        defaultIncomeAmount: 1500.00,
        defaultIncomeDesc: 'Adiantamento Viagens - Dia 15'
    };

    // ===== State =====
    let trips = loadTrips();
    let incomes = loadIncomes();
    let settings = loadSettings();

    let currentDashboardView = 'monthly'; // 'monthly' | 'semester' | 'annual'
    let chartEvolution = null;
    let chartBreakdown = null;
    let modalCallback = null;

    // ===== DOM Ready =====
    document.addEventListener('DOMContentLoaded', init);

    function init() {
        initYearSelects();
        initDefaultDates();
        bindNavigation();
        bindViewSwitcher();
        bindTripForm();
        bindIncomeForm();
        bindSettingsForm();
        bindFilters();
        bindBackupAndExport();
        bindModal();

        loadSettingsIntoForm();
        renderDashboard();
    }

    // ============================
    //  PERSISTENCE
    // ============================
    function loadTrips() {
        try {
            return JSON.parse(localStorage.getItem(TRIPS_KEY)) || [];
        } catch { return []; }
    }

    function saveTrips() {
        localStorage.setItem(TRIPS_KEY, JSON.stringify(trips));
    }

    function loadIncomes() {
        try {
            return JSON.parse(localStorage.getItem(INCOMES_KEY)) || [];
        } catch { return []; }
    }

    function saveIncomes() {
        localStorage.setItem(INCOMES_KEY, JSON.stringify(incomes));
    }

    function loadSettings() {
        try {
            const s = JSON.parse(localStorage.getItem(SETTINGS_KEY));
            return s ? { ...DEFAULT_SETTINGS, ...s } : { ...DEFAULT_SETTINGS };
        } catch { return { ...DEFAULT_SETTINGS }; }
    }

    function saveSettings() {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    }

    // ============================
    //  INIT DATES & YEARS
    // ============================
    function initYearSelects() {
        const currentYear = new Date().getFullYear();
        const years = [currentYear - 2, currentYear - 1, currentYear, currentYear + 1, currentYear + 2];

        const semYearSelect = document.getElementById('dash-semester-year');
        const annualYearSelect = document.getElementById('dash-annual-year');

        semYearSelect.innerHTML = years.map(y => `<option value="${y}" ${y === currentYear ? 'selected' : ''}>${y}</option>`).join('');
        annualYearSelect.innerHTML = years.map(y => `<option value="${y}" ${y === currentYear ? 'selected' : ''}>${y}</option>`).join('');
    }

    function initDefaultDates() {
        const now = new Date();
        const currentMonthStr = now.toISOString().slice(0, 7); // "YYYY-MM"
        const currentDay15 = `${currentMonthStr}-15`;

        const dashMonth = document.getElementById('dash-month');
        if (dashMonth) dashMonth.value = currentMonthStr;

        const incomesFilterMonth = document.getElementById('incomes-filter-month');
        if (incomesFilterMonth) incomesFilterMonth.value = currentMonthStr;

        const filterTripsMonth = document.getElementById('filter-trips-month');
        if (filterTripsMonth) filterTripsMonth.value = currentMonthStr;

        const incomeDate = document.getElementById('income-date');
        if (incomeDate) incomeDate.value = currentDay15;

        const tripDate = document.getElementById('trip-date');
        if (tripDate) tripDate.value = now.toISOString().slice(0, 10);
    }

    // ============================
    //  NAVIGATION
    // ============================
    function bindNavigation() {
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                showPage(btn.dataset.page);
            });
        });

        document.getElementById('btn-quick-trip').addEventListener('click', () => {
            showPage('new-trip');
        });

        document.getElementById('btn-quick-income').addEventListener('click', () => {
            showPage('incomes');
            openIncomeFormWithDay15();
        });
    }

    function showPage(pageId) {
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

        const targetPage = document.getElementById('page-' + pageId);
        const targetBtn = document.querySelector(`.nav-btn[data-page="${pageId}"]`);

        if (targetPage) targetPage.classList.add('active');
        if (targetBtn) targetBtn.classList.add('active');

        if (pageId === 'dashboard') renderDashboard();
        if (pageId === 'incomes') renderIncomesTable();
        if (pageId === 'trips') renderAllTripsTable();
        if (pageId === 'new-trip') prepareNewTripForm();
    }

    // ============================
    //  VIEW SWITCHER (Mensal / Semestral / Anual)
    // ============================
    function bindViewSwitcher() {
        document.querySelectorAll('.view-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentDashboardView = btn.dataset.view;

                // Show corresponding filter controls
                document.getElementById('filter-monthly-ctrl').style.display = currentDashboardView === 'monthly' ? 'flex' : 'none';
                document.getElementById('filter-semester-ctrl').style.display = currentDashboardView === 'semester' ? 'flex' : 'none';
                document.getElementById('filter-annual-ctrl').style.display = currentDashboardView === 'annual' ? 'flex' : 'none';

                renderDashboard();
            });
        });

        // Listen for filter changes in dashboard
        document.getElementById('dash-month').addEventListener('change', renderDashboard);
        document.getElementById('dash-semester-year').addEventListener('change', renderDashboard);
        document.getElementById('dash-semester-opt').addEventListener('change', renderDashboard);
        document.getElementById('dash-annual-year').addEventListener('change', renderDashboard);
    }

    // ============================
    //  CALCULATIONS & HELPERS
    // ============================
    function currency(val) {
        return 'R$ ' + (val || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function fmtKm(val) {
        return (val || 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' km';
    }

    function fmtDate(dateStr) {
        if (!dateStr) return '-';
        const parts = dateStr.split('-');
        if (parts.length !== 3) return dateStr;
        return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }

    // ===== TIME & PONTO HELPERS =====
    function parseTimeToMinutes(str) {
        if (!str || !str.includes(':')) return null;
        const [h, m] = str.split(':').map(Number);
        if (isNaN(h) || isNaN(m)) return null;
        return h * 60 + m;
    }

    function diffMinutes(startMin, endMin) {
        if (startMin === null || endMin === null) return 0;
        let diff = endMin - startMin;
        if (diff < 0) diff += 24 * 60; // caso vire a noite
        return diff;
    }

    function formatMinutes(totalMin) {
        if (!totalMin || totalMin <= 0) return '0h 00m';
        const h = Math.floor(totalMin / 60);
        const m = Math.round(totalMin % 60);
        return `${h}h ${String(m).padStart(2, '0')}m`;
    }

    function calcTripTimes(trip) {
        const startMin = parseTimeToMinutes(trip.timeStart);
        const arrivalMin = parseTimeToMinutes(trip.timeArrival);
        const departureMin = parseTimeToMinutes(trip.timeDeparture);
        const endMin = parseTimeToMinutes(trip.timeEnd);

        if (startMin === null && endMin === null && arrivalMin === null && departureMin === null) {
            return { workMin: 0, serviceMin: 0, driveMin: 0 };
        }

        let workMin = 0;
        let serviceMin = 0;
        let driveMin = 0;

        if (startMin !== null && endMin !== null) {
            workMin = diffMinutes(startMin, endMin);
        }

        if (arrivalMin !== null && departureMin !== null) {
            serviceMin = diffMinutes(arrivalMin, departureMin);
        }

        if (startMin !== null && arrivalMin !== null && departureMin !== null && endMin !== null) {
            const ida = diffMinutes(startMin, arrivalMin);
            const volta = diffMinutes(departureMin, endMin);
            driveMin = ida + volta;
        } else if (workMin > 0) {
            driveMin = Math.max(0, workMin - serviceMin);
        }

        return { workMin, serviceMin, driveMin };
    }

    function calcFuelDetails(km, fuelPrice, kmPerLiter) {
        const price = fuelPrice || settings.fuelPrice;
        const avg = kmPerLiter || settings.kmPerLiter;
        if (!km || !avg) return { liters: 0, cost: 0 };
        const liters = km / avg;
        return { liters, cost: liters * price };
    }

    function calcTripTotal(trip) {
        const fuel = calcFuelDetails(trip.km, trip.fuelPrice, trip.kmPerLiter);
        return fuel.cost + (trip.food || 0) + (trip.toll || 0) + (trip.other || 0);
    }

    // Filter items by current period view
    function isDateInCurrentPeriod(dateStr) {
        if (!dateStr) return false;

        if (currentDashboardView === 'monthly') {
            const targetMonth = document.getElementById('dash-month').value; // "YYYY-MM"
            return dateStr.startsWith(targetMonth);
        }

        if (currentDashboardView === 'semester') {
            const year = document.getElementById('dash-semester-year').value;
            const sem = document.getElementById('dash-semester-opt').value; // '1' or '2'
            if (!dateStr.startsWith(year)) return false;

            const month = parseInt(dateStr.split('-')[1], 10);
            if (sem === '1') return month >= 1 && month <= 6;
            return month >= 7 && month <= 12;
        }

        if (currentDashboardView === 'annual') {
            const year = document.getElementById('dash-annual-year').value;
            return dateStr.startsWith(year);
        }

        return true;
    }

    // ============================
    //  DASHBOARD RENDERING
    // ============================
    function renderDashboard() {
        // Filter trips & incomes
        const periodTrips = trips.filter(t => isDateInCurrentPeriod(t.date));
        const periodIncomes = incomes.filter(i => isDateInCurrentPeriod(i.date));

        // Aggregate Incomes
        const totalIncome = periodIncomes.reduce((acc, i) => acc + (parseFloat(i.amount) || 0), 0);

        // Aggregate Expenses, KM & Times
        let totalKm = 0;
        let totalFuel = 0;
        let totalFood = 0;
        let totalToll = 0;
        let totalOther = 0;
        let totalWorkMinutes = 0;
        let totalDriveMinutes = 0;
        let totalServiceMinutes = 0;

        periodTrips.forEach(t => {
            totalKm += parseFloat(t.km) || 0;
            totalFuel += calcFuelDetails(t.km, t.fuelPrice, t.kmPerLiter).cost;
            totalFood += parseFloat(t.food) || 0;
            totalToll += parseFloat(t.toll) || 0;
            totalOther += parseFloat(t.other) || 0;

            const times = calcTripTimes(t);
            totalWorkMinutes += times.workMin;
            totalDriveMinutes += times.driveMin;
            totalServiceMinutes += times.serviceMin;
        });

        const totalExpense = totalFuel + totalFood + totalToll + totalOther;
        const balance = totalIncome - totalExpense;

        // Update DOM - Balance Banner
        document.getElementById('stat-total-income').textContent = currency(totalIncome);
        document.getElementById('stat-total-expense').textContent = currency(totalExpense);

        const balEl = document.getElementById('stat-balance');
        balEl.textContent = currency(balance);
        balEl.className = 'bal-value ' + (balance >= 0 ? 'positive' : 'negative');

        // Update DOM - Time & Ponto Banner
        document.getElementById('stat-total-worktime').textContent = formatMinutes(totalWorkMinutes);
        document.getElementById('stat-total-drive').textContent = formatMinutes(totalDriveMinutes);
        document.getElementById('stat-total-service').textContent = formatMinutes(totalServiceMinutes);

        // Update DOM - Secondary Stats
        document.getElementById('stat-trips-count').textContent = periodTrips.length;
        document.getElementById('stat-km-total').textContent = fmtKm(totalKm);
        document.getElementById('stat-fuel-total').textContent = currency(totalFuel);
        document.getElementById('stat-food-total').textContent = currency(totalFood);
        document.getElementById('stat-toll-total').textContent = currency(totalToll);
        document.getElementById('stat-other-total').textContent = currency(totalOther);

        // Update Charts
        renderEvolutionChart(periodIncomes, periodTrips);
        renderBreakdownChart(totalFuel, totalFood, totalToll, totalOther);

        // Update Summary Table
        renderPeriodSummaryTable(periodIncomes, periodTrips);
    }

    // Gráfico de Evolução / Comparativo Entradas vs Gastos
    function renderEvolutionChart(periodIncomes, periodTrips) {
        const ctx = document.getElementById('chart-evolution').getContext('2d');
        const badge = document.getElementById('chart-view-badge');

        if (chartEvolution) chartEvolution.destroy();

        let labels = [];
        let incomeData = [];
        let expenseData = [];

        const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

        if (currentDashboardView === 'monthly') {
            badge.textContent = 'Mensal';
            // Mostrar categorias de comparação direta
            labels = ['Total do Mês'];
            const incTotal = periodIncomes.reduce((acc, i) => acc + (parseFloat(i.amount) || 0), 0);
            let expTotal = 0;
            periodTrips.forEach(t => expTotal += calcTripTotal(t));

            incomeData = [incTotal];
            expenseData = [expTotal];
        } else if (currentDashboardView === 'semester') {
            const sem = document.getElementById('dash-semester-opt').value;
            const startMonth = sem === '1' ? 1 : 7;
            const endMonth = sem === '1' ? 6 : 12;
            badge.textContent = sem === '1' ? '1º Semestre' : '2º Semestre';

            for (let m = startMonth; m <= endMonth; m++) {
                const monthPad = String(m).padStart(2, '0');
                labels.push(monthNames[m - 1]);

                // Filter for this specific month
                const mIncomes = periodIncomes.filter(i => i.date && i.date.split('-')[1] === monthPad);
                const mTrips = periodTrips.filter(t => t.date && t.date.split('-')[1] === monthPad);

                const inc = mIncomes.reduce((acc, i) => acc + (parseFloat(i.amount) || 0), 0);
                let exp = 0;
                mTrips.forEach(t => exp += calcTripTotal(t));

                incomeData.push(inc);
                expenseData.push(exp);
            }
        } else if (currentDashboardView === 'annual') {
            badge.textContent = 'Anual (12 Meses)';
            for (let m = 1; m <= 12; m++) {
                const monthPad = String(m).padStart(2, '0');
                labels.push(monthNames[m - 1]);

                const mIncomes = periodIncomes.filter(i => i.date && i.date.split('-')[1] === monthPad);
                const mTrips = periodTrips.filter(t => t.date && t.date.split('-')[1] === monthPad);

                const inc = mIncomes.reduce((acc, i) => acc + (parseFloat(i.amount) || 0), 0);
                let exp = 0;
                mTrips.forEach(t => exp += calcTripTotal(t));

                incomeData.push(inc);
                expenseData.push(exp);
            }
        }

        chartEvolution = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Entradas (R$)',
                        data: incomeData,
                        backgroundColor: '#10b981',
                        borderRadius: 6
                    },
                    {
                        label: 'Gastos (R$)',
                        data: expenseData,
                        backgroundColor: '#ef4444',
                        borderRadius: 6
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: val => 'R$ ' + val.toLocaleString('pt-BR')
                        }
                    }
                },
                plugins: {
                    legend: { position: 'top' },
                    tooltip: {
                        callbacks: {
                            label: ctx => `${ctx.dataset.label}: ${currency(ctx.raw)}`
                        }
                    }
                }
            }
        });
    }

    // Gráfico de Composição dos Gastos
    function renderBreakdownChart(fuel, food, toll, other) {
        const ctx = document.getElementById('chart-breakdown').getContext('2d');
        if (chartBreakdown) chartBreakdown.destroy();

        const total = fuel + food + toll + other;

        if (total === 0) {
            chartBreakdown = new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: ['Sem gastos'],
                    datasets: [{ data: [1], backgroundColor: ['#e2e8f0'] }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { position: 'bottom' } }
                }
            });
            return;
        }

        chartBreakdown = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['Combustível', 'Alimentação', 'Pedágios', 'Outros'],
                datasets: [{
                    data: [fuel, food, toll, other],
                    backgroundColor: ['#2563eb', '#f59e0b', '#10b981', '#8b5cf6'],
                    borderWidth: 2,
                    borderColor: '#ffffff'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom' },
                    tooltip: {
                        callbacks: {
                            label: ctx => `${ctx.label}: ${currency(ctx.raw)} (${((ctx.raw / total) * 100).toFixed(1)}%)`
                        }
                    }
                }
            }
        });
    }

    // Tabela unificada do período
    function renderPeriodSummaryTable(periodIncomes, periodTrips) {
        const tbody = document.querySelector('#period-summary-table tbody');

        // Merge entries
        const items = [];
        periodIncomes.forEach(i => {
            items.push({
                type: 'income',
                date: i.date,
                title: i.category + (i.description ? ` (${i.description})` : ''),
                km: '-',
                amount: parseFloat(i.amount) || 0
            });
        });

        periodTrips.forEach(t => {
            const total = calcTripTotal(t);
            const route = t.origin ? `${t.origin} → ${t.destination}` : t.destination;
            const times = calcTripTimes(t);
            const timeDesc = (t.timeStart && t.timeEnd) 
                ? `${t.timeStart} - ${t.timeEnd} (Dir: ${formatMinutes(times.driveMin)} | Serv: ${formatMinutes(times.serviceMin)})`
                : '-';

            items.push({
                type: 'trip',
                date: t.date,
                title: `${route} ${t.purpose ? '- ' + t.purpose : ''}`,
                timeInfo: timeDesc,
                km: fmtKm(t.km),
                amount: total
            });
        });

        items.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

        if (items.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:2rem;">Nenhum lançamento no período selecionado.</td></tr>';
            return;
        }

        tbody.innerHTML = items.slice(0, 15).map(item => `
            <tr>
                <td>${fmtDate(item.date)}</td>
                <td>
                    <span class="${item.type === 'income' ? 'badge-income' : 'badge-trip'}">
                        ${item.type === 'income' ? '💵 Entrada' : '🚗 Viagem'}
                    </span>
                </td>
                <td>${escapeHtml(item.title)}</td>
                <td><small style="color:var(--text-muted);font-weight:500;">${item.timeInfo || '-'}</small></td>
                <td>${item.km}</td>
                <td class="${item.type === 'income' ? 'text-income' : 'text-expense'}">
                    ${item.type === 'income' ? '+' : '-'} ${currency(item.amount)}
                </td>
            </tr>
        `).join('');
    }

    // ============================
    //  INCOMES MANAGEMENT (DIA 15)
    // ============================
    function bindIncomeForm() {
        const openBtn = document.getElementById('btn-open-income-form');
        const container = document.getElementById('income-form-container');
        const cancelBtn = document.getElementById('btn-cancel-income');
        const form = document.getElementById('income-form');

        openBtn.addEventListener('click', () => {
            container.style.display = container.style.display === 'none' ? 'block' : 'none';
            if (container.style.display === 'block') {
                openIncomeFormWithDay15();
            }
        });

        cancelBtn.addEventListener('click', () => {
            container.style.display = 'none';
            form.reset();
        });

        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const id = document.getElementById('income-id').value;
            const newIncome = {
                id: id || Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                date: document.getElementById('income-date').value,
                amount: parseFloat(document.getElementById('income-amount').value) || 0,
                category: document.getElementById('income-category').value,
                description: document.getElementById('income-desc').value.trim(),
                createdAt: id ? (incomes.find(i => i.id === id)?.createdAt || new Date().toISOString()) : new Date().toISOString()
            };

            if (id) {
                const idx = incomes.findIndex(i => i.id === id);
                if (idx !== -1) incomes[idx] = newIncome;
                showToast('Entrada atualizada com sucesso!');
            } else {
                incomes.push(newIncome);
                showToast('Entrada salva com sucesso!');
            }

            saveIncomes();
            form.reset();
            container.style.display = 'none';
            renderIncomesTable();
            renderDashboard();
        });

        // Incomes filter
        document.getElementById('incomes-filter-month').addEventListener('change', renderIncomesTable);
        document.getElementById('btn-incomes-clear-filter').addEventListener('click', () => {
            document.getElementById('incomes-filter-month').value = '';
            renderIncomesTable();
        });
    }

    function openIncomeFormWithDay15() {
        const container = document.getElementById('income-form-container');
        container.style.display = 'block';
        document.getElementById('income-form-title').textContent = 'Cadastrar Entrada (Dia 15)';
        document.getElementById('income-id').value = '';

        // Default to active month's 15th
        const dashMonth = document.getElementById('dash-month').value || new Date().toISOString().slice(0, 7);
        document.getElementById('income-date').value = `${dashMonth}-15`;
        document.getElementById('income-amount').value = settings.defaultIncomeAmount || '';
        document.getElementById('income-desc').value = settings.defaultIncomeDesc || 'Adiantamento Viagens - Dia 15';
        document.getElementById('income-category').value = 'Adiantamento Dia 15';

        document.getElementById('income-amount').focus();
    }

    function renderIncomesTable() {
        const monthFilter = document.getElementById('incomes-filter-month').value;
        let filtered = [...incomes];

        if (monthFilter) {
            filtered = filtered.filter(i => i.date && i.date.startsWith(monthFilter));
        }

        filtered.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

        const tbody = document.querySelector('#incomes-table tbody');
        const noMsg = document.getElementById('no-incomes-msg');

        if (filtered.length === 0) {
            tbody.innerHTML = '';
            noMsg.style.display = 'block';
            document.getElementById('incomes-table').style.display = 'none';
            return;
        }

        noMsg.style.display = 'none';
        document.getElementById('incomes-table').style.display = '';

        tbody.innerHTML = filtered.map(i => `
            <tr>
                <td>${fmtDate(i.date)}</td>
                <td><span class="badge-income">${escapeHtml(i.category)}</span></td>
                <td>${escapeHtml(i.description || '-')}</td>
                <td class="text-income">${currency(parseFloat(i.amount))}</td>
                <td class="actions">
                    <button class="btn-icon btn-edit-income" data-id="${i.id}" title="Editar">✏️</button>
                    <button class="btn-icon btn-del-income" data-id="${i.id}" title="Excluir">🗑️</button>
                </td>
            </tr>
        `).join('');

        tbody.querySelectorAll('.btn-edit-income').forEach(b => {
            b.addEventListener('click', () => editIncome(b.dataset.id));
        });

        tbody.querySelectorAll('.btn-del-income').forEach(b => {
            b.addEventListener('click', () => {
                showConfirm('Excluir Entrada', 'Deseja excluir esta entrada?', () => {
                    incomes = incomes.filter(i => i.id !== b.dataset.id);
                    saveIncomes();
                    renderIncomesTable();
                    renderDashboard();
                    showToast('Entrada excluída.');
                });
            });
        });
    }

    function editIncome(id) {
        const inc = incomes.find(i => i.id === id);
        if (!inc) return;

        const container = document.getElementById('income-form-container');
        container.style.display = 'block';
        document.getElementById('income-form-title').textContent = 'Editar Entrada';
        document.getElementById('income-id').value = inc.id;
        document.getElementById('income-date').value = inc.date;
        document.getElementById('income-amount').value = inc.amount;
        document.getElementById('income-category').value = inc.category;
        document.getElementById('income-desc').value = inc.description || '';

        container.scrollIntoView({ behavior: 'smooth' });
    }

    // ============================
    //  TRIP FORM (CÁLCULO AUTOMÁTICO)
    // ============================
    function bindTripForm() {
        const form = document.getElementById('trip-form');
        form.addEventListener('submit', handleTripSubmit);
        document.getElementById('btn-cancel-trip').addEventListener('click', () => {
            showPage('trips');
        });

        // Live calculation triggers (KM, Preços e Horários)
        [
            'trip-km', 'trip-fuel-price', 'trip-km-per-liter',
            'trip-food', 'trip-toll', 'trip-other',
            'trip-time-start', 'trip-time-arrival', 'trip-time-departure', 'trip-time-end'
        ].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('input', updateTripLiveCalc);
        });
    }

    function prepareNewTripForm() {
        const form = document.getElementById('trip-form');
        form.reset();
        document.getElementById('trip-id').value = '';
        document.getElementById('form-trip-title').textContent = 'Nova Viagem de Trabalho';
        document.getElementById('btn-save-trip').textContent = '💾 Salvar Viagem';

        document.getElementById('trip-date').value = new Date().toISOString().slice(0, 10);
        document.getElementById('trip-origin').value = settings.defaultOrigin || '';
        document.getElementById('trip-km-per-liter').placeholder = settings.kmPerLiter;
        document.getElementById('trip-fuel-price').placeholder = settings.fuelPrice.toFixed(2);

        // Reset times
        document.getElementById('trip-time-start').value = '';
        document.getElementById('trip-time-arrival').value = '';
        document.getElementById('trip-time-departure').value = '';
        document.getElementById('trip-time-end').value = '';

        updateTripLiveCalc();
    }

    function updateTripLiveCalc() {
        const km = parseFloat(document.getElementById('trip-km').value) || 0;
        const fuelPrice = parseFloat(document.getElementById('trip-fuel-price').value) || settings.fuelPrice;
        const kmPerLiter = parseFloat(document.getElementById('trip-km-per-liter').value) || settings.kmPerLiter;
        const food = parseFloat(document.getElementById('trip-food').value) || 0;
        const toll = parseFloat(document.getElementById('trip-toll').value) || 0;
        const other = parseFloat(document.getElementById('trip-other').value) || 0;

        const fuel = calcFuelDetails(km, fuelPrice, kmPerLiter);

        document.getElementById('calc-liters').textContent = (fuel.liters).toFixed(1).replace('.', ',') + ' L';
        document.getElementById('calc-fuel-cost').textContent = currency(fuel.cost);

        const total = fuel.cost + food + toll + other;
        document.getElementById('calc-trip-total').textContent = currency(total);

        // Live calculation of times (Ponto / Volante / Serviço)
        const times = calcTripTimes({
            timeStart: document.getElementById('trip-time-start').value,
            timeArrival: document.getElementById('trip-time-arrival').value,
            timeDeparture: document.getElementById('trip-time-departure').value,
            timeEnd: document.getElementById('trip-time-end').value
        });

        document.getElementById('calc-drive-time').textContent = formatMinutes(times.driveMin);
        document.getElementById('calc-service-time').textContent = formatMinutes(times.serviceMin);
        document.getElementById('calc-work-time').textContent = formatMinutes(times.workMin);
    }

    function handleTripSubmit(e) {
        e.preventDefault();

        const id = document.getElementById('trip-id').value;
        const trip = {
            id: id || Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            date: document.getElementById('trip-date').value,
            destination: document.getElementById('trip-destination').value.trim(),
            origin: document.getElementById('trip-origin').value.trim(),
            purpose: document.getElementById('trip-purpose').value.trim(),
            timeStart: document.getElementById('trip-time-start').value || '',
            timeArrival: document.getElementById('trip-time-arrival').value || '',
            timeDeparture: document.getElementById('trip-time-departure').value || '',
            timeEnd: document.getElementById('trip-time-end').value || '',
            km: parseFloat(document.getElementById('trip-km').value) || 0,
            fuelPrice: parseFloat(document.getElementById('trip-fuel-price').value) || null,
            kmPerLiter: parseFloat(document.getElementById('trip-km-per-liter').value) || null,
            food: parseFloat(document.getElementById('trip-food').value) || 0,
            toll: parseFloat(document.getElementById('trip-toll').value) || 0,
            other: parseFloat(document.getElementById('trip-other').value) || 0,
            otherDesc: document.getElementById('trip-other-desc').value.trim(),
            notes: document.getElementById('trip-notes').value.trim(),
            createdAt: id ? (trips.find(t => t.id === id)?.createdAt || new Date().toISOString()) : new Date().toISOString()
        };

        if (id) {
            const idx = trips.findIndex(t => t.id === id);
            if (idx !== -1) trips[idx] = trip;
            showToast('Viagem atualizada com sucesso!');
        } else {
            trips.push(trip);
            showToast('Viagem cadastrada com sucesso!');
        }

        saveTrips();
        showPage('trips');
    }

    function editTrip(id) {
        const trip = trips.find(t => t.id === id);
        if (!trip) return;

        showPage('new-trip');
        document.getElementById('form-trip-title').textContent = 'Editar Viagem';
        document.getElementById('btn-save-trip').textContent = '💾 Atualizar Viagem';

        document.getElementById('trip-id').value = trip.id;
        document.getElementById('trip-date').value = trip.date;
        document.getElementById('trip-destination').value = trip.destination;
        document.getElementById('trip-origin').value = trip.origin || '';
        document.getElementById('trip-purpose').value = trip.purpose || '';
        document.getElementById('trip-time-start').value = trip.timeStart || '';
        document.getElementById('trip-time-arrival').value = trip.timeArrival || '';
        document.getElementById('trip-time-departure').value = trip.timeDeparture || '';
        document.getElementById('trip-time-end').value = trip.timeEnd || '';
        document.getElementById('trip-km').value = trip.km;
        document.getElementById('trip-fuel-price').value = trip.fuelPrice || '';
        document.getElementById('trip-km-per-liter').value = trip.kmPerLiter || '';
        document.getElementById('trip-food').value = trip.food || '';
        document.getElementById('trip-toll').value = trip.toll || '';
        document.getElementById('trip-other').value = trip.other || '';
        document.getElementById('trip-other-desc').value = trip.otherDesc || '';
        document.getElementById('trip-notes').value = trip.notes || '';

        updateTripLiveCalc();
    }

    // ============================
    //  ALL TRIPS TABLE
    // ============================
    function bindFilters() {
        document.getElementById('filter-trips-search').addEventListener('input', renderAllTripsTable);
        document.getElementById('filter-trips-month').addEventListener('change', renderAllTripsTable);
        document.getElementById('btn-trips-clear-filter').addEventListener('click', () => {
            document.getElementById('filter-trips-search').value = '';
            document.getElementById('filter-trips-month').value = '';
            renderAllTripsTable();
        });
    }

    function renderAllTripsTable() {
        const search = (document.getElementById('filter-trips-search').value || '').toLowerCase();
        const month = document.getElementById('filter-trips-month').value;

        let filtered = [...trips];

        if (search) {
            filtered = filtered.filter(t =>
                t.destination.toLowerCase().includes(search) ||
                (t.origin || '').toLowerCase().includes(search) ||
                (t.purpose || '').toLowerCase().includes(search)
            );
        }

        if (month) {
            filtered = filtered.filter(t => t.date && t.date.startsWith(month));
        }

        filtered.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

        const tbody = document.querySelector('#all-trips-table tbody');
        const noMsg = document.getElementById('no-trips-msg');

        if (filtered.length === 0) {
            tbody.innerHTML = '';
            noMsg.style.display = 'block';
            document.getElementById('all-trips-table').style.display = 'none';
            return;
        }

        noMsg.style.display = 'none';
        document.getElementById('all-trips-table').style.display = '';

        tbody.innerHTML = filtered.map(t => {
            const fuel = calcFuelDetails(t.km, t.fuelPrice, t.kmPerLiter);
            const total = calcTripTotal(t);
            const route = t.origin ? `${t.origin} → ${t.destination}` : t.destination;
            const times = calcTripTimes(t);
            const pontoStr = (t.timeStart && t.timeEnd) ? `${t.timeStart} - ${t.timeEnd}` : (t.timeStart || t.timeEnd || '-');

            return `<tr>
                <td>${fmtDate(t.date)}</td>
                <td><small style="font-weight:600;color:var(--text-main);">${escapeHtml(pontoStr)}</small></td>
                <td><strong>${escapeHtml(route)}</strong></td>
                <td>${escapeHtml(t.purpose || '-')}</td>
                <td>${fmtKm(t.km)}</td>
                <td><span style="color:#2563eb;font-weight:600;">${formatMinutes(times.driveMin)}</span></td>
                <td><span style="color:#8b5cf6;font-weight:600;">${formatMinutes(times.serviceMin)}</span></td>
                <td>${currency(fuel.cost)}</td>
                <td>${currency(t.food)}</td>
                <td>${currency(t.toll)}</td>
                <td class="text-expense">${currency(total)}</td>
                <td class="actions">
                    <button class="btn-icon btn-edit-trip" data-id="${t.id}" title="Editar">✏️</button>
                    <button class="btn-icon btn-del-trip" data-id="${t.id}" title="Excluir">🗑️</button>
                </td>
            </tr>`;
        }).join('');

        tbody.querySelectorAll('.btn-edit-trip').forEach(b => {
            b.addEventListener('click', () => editTrip(b.dataset.id));
        });

        tbody.querySelectorAll('.btn-del-trip').forEach(b => {
            b.addEventListener('click', () => {
                showConfirm('Excluir Viagem', 'Tem certeza que deseja excluir esta viagem?', () => {
                    trips = trips.filter(t => t.id !== b.dataset.id);
                    saveTrips();
                    renderAllTripsTable();
                    renderDashboard();
                    showToast('Viagem excluída.');
                });
            });
        });
    }

    // ============================
    //  SETTINGS & AUTOMATION DIA 15
    // ============================
    function bindSettingsForm() {
        document.getElementById('settings-form').addEventListener('submit', (e) => {
            e.preventDefault();
            settings.carModel = document.getElementById('cfg-car-model').value.trim();
            settings.kmPerLiter = parseFloat(document.getElementById('cfg-km-per-liter').value) || 10;
            settings.fuelType = document.getElementById('cfg-fuel-type').value;
            settings.fuelPrice = parseFloat(document.getElementById('cfg-fuel-price').value) || 5.80;
            settings.defaultOrigin = document.getElementById('cfg-default-origin').value.trim();
            settings.defaultIncomeAmount = parseFloat(document.getElementById('cfg-default-income-amount').value) || 0;
            settings.defaultIncomeDesc = document.getElementById('cfg-default-income-desc').value.trim() || 'Adiantamento Viagens - Dia 15';

            saveSettings();
            showToast('Configurações salvas!');
            renderDashboard();
        });

        // Botão para gerar entradas do dia 15 para todo o ano
        document.getElementById('btn-generate-yearly-incomes').addEventListener('click', () => {
            const amount = parseFloat(document.getElementById('cfg-default-income-amount').value) || settings.defaultIncomeAmount;
            if (!amount || amount <= 0) {
                showToast('Informe um valor padrão maior que zero!', true);
                return;
            }

            const currentYear = new Date().getFullYear();
            showConfirm(
                'Gerar Entradas do Dia 15',
                `Deseja gerar automaticamente 12 entradas (uma no dia 15 de cada mês de ${currentYear}) no valor de ${currency(amount)}?`,
                () => {
                    let createdCount = 0;
                    for (let m = 1; m <= 12; m++) {
                        const mPad = String(m).padStart(2, '0');
                        const targetDate = `${currentYear}-${mPad}-15`;

                        // Check if already exists for this exact day
                        const alreadyExists = incomes.some(i => i.date === targetDate);
                        if (!alreadyExists) {
                            incomes.push({
                                id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                                date: targetDate,
                                amount,
                                category: 'Adiantamento Dia 15',
                                description: settings.defaultIncomeDesc || 'Adiantamento Viagens - Dia 15',
                                createdAt: new Date().toISOString()
                            });
                            createdCount++;
                        }
                    }
                    saveIncomes();
                    renderDashboard();
                    showToast(`${createdCount} entradas geradas com sucesso!`);
                }
            );
        });
    }

    function loadSettingsIntoForm() {
        document.getElementById('cfg-car-model').value = settings.carModel || '';
        document.getElementById('cfg-km-per-liter').value = settings.kmPerLiter;
        document.getElementById('cfg-fuel-type').value = settings.fuelType || 'Gasolina';
        document.getElementById('cfg-fuel-price').value = settings.fuelPrice;
        document.getElementById('cfg-default-origin').value = settings.defaultOrigin || '';
        document.getElementById('cfg-default-income-amount').value = settings.defaultIncomeAmount || '';
        document.getElementById('cfg-default-income-desc').value = settings.defaultIncomeDesc || '';
    }

    // ============================
    //  EXPORT & BACKUP
    // ============================
    function bindBackupAndExport() {
        // CSV Export
        document.getElementById('btn-export-csv').addEventListener('click', exportFullCSV);

        // JSON Export
        document.getElementById('btn-export-json').addEventListener('click', () => {
            const backup = { trips, incomes, settings, exportedAt: new Date().toISOString() };
            const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
            downloadBlob(blob, `viagemcontrol-backup-${new Date().toISOString().slice(0, 10)}.json`);
            showToast('Backup JSON exportado!');
        });

        // JSON Import
        document.getElementById('btn-import-json').addEventListener('click', () => {
            document.getElementById('file-import').click();
        });

        document.getElementById('file-import').addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (ev) => {
                try {
                    const data = JSON.parse(ev.target.result);
                    if (data.trips || data.incomes) {
                        showConfirm('Restaurar Backup', 'Isso substituirá seus registros atuais. Deseja prosseguir?', () => {
                            if (Array.isArray(data.trips)) trips = data.trips;
                            if (Array.isArray(data.incomes)) incomes = data.incomes;
                            if (data.settings) settings = { ...DEFAULT_SETTINGS, ...data.settings };

                            saveTrips();
                            saveIncomes();
                            saveSettings();
                            loadSettingsIntoForm();
                            renderDashboard();
                            showToast('Backup restaurado com sucesso!');
                        });
                    } else {
                        showToast('Arquivo JSON com formato inválido!', true);
                    }
                } catch {
                    showToast('Erro ao ler o arquivo JSON.', true);
                }
            };
            reader.readAsText(file);
            e.target.value = '';
        });

        // Clear All
        document.getElementById('btn-clear-all').addEventListener('click', () => {
            showConfirm('⚠️ Limpar Tudo', 'Tem certeza de que deseja apagar TODAS as viagens e entradas? Essa ação não pode ser desfeita.', () => {
                trips = [];
                incomes = [];
                saveTrips();
                saveIncomes();
                renderDashboard();
                showToast('Todos os registros foram apagados.');
            });
        });
    }

    function exportFullCSV() {
        const sep = ';';
        const lines = [];

        lines.push('RELATORIO GERAL - VIAGEMCONTROL');
        lines.push('Gerado em: ' + new Date().toLocaleString('pt-BR'));
        lines.push('');

        // 1. Incomes Section
        lines.push('--- ENTRADAS (REEMBOLSOS / ADIANTAMENTOS DIA 15) ---');
        lines.push(['Data', 'Categoria', 'Descricao', 'Valor (R$)'].join(sep));
        incomes.slice().sort((a,b) => (a.date || '').localeCompare(b.date || '')).forEach(i => {
            lines.push([
                fmtDate(i.date),
                `"${i.category}"`,
                `"${(i.description || '').replace(/"/g, '""')}"`,
                (parseFloat(i.amount) || 0).toFixed(2).replace('.', ',')
            ].join(sep));
        });

        lines.push('');
        // 2. Trips Section
        lines.push('--- VIAGENS E DESPESAS ---');
        lines.push([
            'Data', 'Saida_Base', 'Chegada_Destino', 'Saida_Destino', 'Chegada_Final',
            'Tempo_Volante', 'Tempo_Servico', 'Jornada_Total',
            'Origem', 'Destino', 'Motivo', 'KM', 'Preco_Combustivel',
            'Media_KM_L', 'Litros_Gastos', 'Custo_Combustivel', 'Alimentacao',
            'Pedagios', 'Outros', 'Descricao_Outros', 'Total_Viagem', 'Observacoes'
        ].join(sep));

        trips.slice().sort((a,b) => (a.date || '').localeCompare(b.date || '')).forEach(t => {
            const fuel = calcFuelDetails(t.km, t.fuelPrice, t.kmPerLiter);
            const total = calcTripTotal(t);
            const times = calcTripTimes(t);

            lines.push([
                fmtDate(t.date),
                `"${t.timeStart || ''}"`,
                `"${t.timeArrival || ''}"`,
                `"${t.timeDeparture || ''}"`,
                `"${t.timeEnd || ''}"`,
                `"${formatMinutes(times.driveMin)}"`,
                `"${formatMinutes(times.serviceMin)}"`,
                `"${formatMinutes(times.workMin)}"`,
                `"${(t.origin || '').replace(/"/g, '""')}"`,
                `"${(t.destination || '').replace(/"/g, '""')}"`,
                `"${(t.purpose || '').replace(/"/g, '""')}"`,
                (t.km || 0).toFixed(1).replace('.', ','),
                (t.fuelPrice || settings.fuelPrice).toFixed(2).replace('.', ','),
                (t.kmPerLiter || settings.kmPerLiter).toFixed(1).replace('.', ','),
                (fuel.liters).toFixed(2).replace('.', ','),
                (fuel.cost).toFixed(2).replace('.', ','),
                (t.food || 0).toFixed(2).replace('.', ','),
                (t.toll || 0).toFixed(2).replace('.', ','),
                (t.other || 0).toFixed(2).replace('.', ','),
                `"${(t.otherDesc || '').replace(/"/g, '""')}"`,
                (total).toFixed(2).replace('.', ','),
                `"${(t.notes || '').replace(/[\r\n]+/g, ' ').replace(/"/g, '""')}"`
            ].join(sep));
        });

        const csvContent = '\uFEFF' + lines.join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
        downloadBlob(blob, `relatorio-viagens-entradas-${new Date().toISOString().slice(0, 10)}.csv`);
        showToast('Relatório CSV exportado!');
    }

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // ============================
    //  MODAL & TOAST
    // ============================
    function bindModal() {
        document.getElementById('modal-cancel').addEventListener('click', hideModal);
        document.getElementById('modal-confirm').addEventListener('click', () => {
            hideModal();
            if (modalCallback) modalCallback();
        });
    }

    function showConfirm(title, msg, callback) {
        document.getElementById('modal-title').textContent = title;
        document.getElementById('modal-msg').textContent = msg;
        document.getElementById('confirm-modal').style.display = 'flex';
        modalCallback = callback;
    }

    function hideModal() {
        document.getElementById('confirm-modal').style.display = 'none';
        modalCallback = null;
    }

    function showToast(msg, isError = false) {
        const toast = document.getElementById('toast');
        toast.textContent = msg;
        toast.className = 'toast' + (isError ? ' error' : '');
        toast.style.display = 'block';
        clearTimeout(toast._timer);
        toast._timer = setTimeout(() => { toast.style.display = 'none'; }, 3200);
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str || '';
        return div.innerHTML;
    }

})();
