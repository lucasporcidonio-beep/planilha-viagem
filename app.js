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
        wearCostPerKm: 0.45,
        carOdometer: 85000,
        defaultOrigin: '',
        defaultIncomeAmount: 1500.00,
        defaultIncomeDesc: 'Adiantamento Viagens - Dia 15',
        maintenanceHistory: {
            oilChange: 80000,
            tireRotation: 80000,
            brakes: 70000,
            tires: 60000,
            generalReview: 50000
        }
    };

    // ===== State =====
    let trips = loadTrips();
    let incomes = loadIncomes();
    let settings = loadSettings();

    let currentDashboardView = 'monthly'; // 'monthly' | 'semester' | 'annual'
    let currentTripStores = []; // Lojas da viagem sendo cadastrada/editada
    let currentTripExpenses = []; // Gastos detalhados (pedágios, alimentação, etc.)
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
        bindRouteButtons();
        bindStoresEvents();
        bindExpenseItemsEvents();

        loadSettingsIntoForm();
        renderDashboard();

        // Inicia sincronização em nuvem com o Firebase Firestore
        initFirebaseSync();
    }

    // ============================
    //  PERSISTENCE & FIREBASE SYNC
    // ============================
    function loadTrips() {
        try {
            return JSON.parse(localStorage.getItem(TRIPS_KEY)) || [];
        } catch { return []; }
    }

    function saveTripsLocal() {
        localStorage.setItem(TRIPS_KEY, JSON.stringify(trips));
    }

    function saveTrips() {
        saveTripsLocal();
    }

    function saveTripCloud(trip) {
        saveTripsLocal();
        if (db && isFirebaseReady) {
            db.collection('trips').doc(trip.id).set(trip).catch(err => {
                console.error('Erro ao salvar viagem no Firestore:', err);
            });
        }
    }

    function deleteTripCloud(tripId) {
        trips = trips.filter(t => t.id !== tripId);
        saveTripsLocal();
        if (db && isFirebaseReady) {
            db.collection('trips').doc(tripId).delete().catch(err => {
                console.error('Erro ao excluir viagem no Firestore:', err);
            });
        }
    }

    function loadIncomes() {
        try {
            return JSON.parse(localStorage.getItem(INCOMES_KEY)) || [];
        } catch { return []; }
    }

    function saveIncomesLocal() {
        localStorage.setItem(INCOMES_KEY, JSON.stringify(incomes));
    }

    function saveIncomes() {
        saveIncomesLocal();
    }

    function saveIncomeCloud(income) {
        saveIncomesLocal();
        if (db && isFirebaseReady) {
            db.collection('incomes').doc(income.id).set(income).catch(err => {
                console.error('Erro ao salvar entrada no Firestore:', err);
            });
        }
    }

    function deleteIncomeCloud(incomeId) {
        incomes = incomes.filter(i => i.id !== incomeId);
        saveIncomesLocal();
        if (db && isFirebaseReady) {
            db.collection('incomes').doc(incomeId).delete().catch(err => {
                console.error('Erro ao excluir entrada no Firestore:', err);
            });
        }
    }

    function loadSettings() {
        try {
            const s = JSON.parse(localStorage.getItem(SETTINGS_KEY));
            return s ? { ...DEFAULT_SETTINGS, ...s } : { ...DEFAULT_SETTINGS };
        } catch { return { ...DEFAULT_SETTINGS }; }
    }

    function saveSettingsLocal() {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    }

    function saveSettings() {
        saveSettingsLocal();
        saveSettingsCloud(settings);
    }

    function saveSettingsCloud(st) {
        saveSettingsLocal();
        if (db && isFirebaseReady) {
            db.collection('settings').doc('global').set(st).catch(err => {
                console.error('Erro ao salvar configurações no Firestore:', err);
            });
        }
    }

    // ============================
    //  FIREBASE CLOUD LISTENERS
    // ============================
    function initFirebaseSync() {
        if (typeof db === 'undefined' || !db) {
            updateCloudStatus('error', 'Nuvem Não Carregada');
            return;
        }

        updateCloudStatus('connecting', 'Conectando Nuvem...');

        // 1. Escuta em tempo real de viagens
        db.collection('trips').onSnapshot((snapshot) => {
            const remoteTrips = [];
            snapshot.forEach(doc => {
                remoteTrips.push({ id: doc.id, ...doc.data() });
            });

            // Se o Firestore estava vazio e temos dados locais, faz o upload inicial
            if (remoteTrips.length === 0 && trips.length > 0) {
                console.log('Sincronizando dados locais existentes para o Firestore...');
                trips.forEach(t => db.collection('trips').doc(t.id).set(t));
            } else if (remoteTrips.length > 0) {
                trips = remoteTrips;
                saveTripsLocal();
                refreshCurrentView();
            }
            updateCloudStatus('online', 'Nuvem Conectada');
        }, (error) => {
            console.error('Erro na sincronização de viagens:', error);
            updateCloudStatus('error', 'Offline / Erro Nuvem');
        });

        // 2. Escuta em tempo real de entradas (Dia 15)
        db.collection('incomes').onSnapshot((snapshot) => {
            const remoteIncomes = [];
            snapshot.forEach(doc => {
                remoteIncomes.push({ id: doc.id, ...doc.data() });
            });

            if (remoteIncomes.length === 0 && incomes.length > 0) {
                incomes.forEach(i => db.collection('incomes').doc(i.id).set(i));
            } else if (remoteIncomes.length > 0) {
                incomes = remoteIncomes;
                saveIncomesLocal();
                refreshCurrentView();
            }
        }, (error) => {
            console.error('Erro na sincronização de entradas:', error);
        });

        // 3. Escuta em tempo real de configurações
        db.collection('settings').doc('global').onSnapshot((doc) => {
            if (doc.exists) {
                settings = { ...DEFAULT_SETTINGS, ...doc.data() };
                saveSettingsLocal();
                loadSettingsIntoForm();
                refreshCurrentView();
            } else if (settings) {
                db.collection('settings').doc('global').set(settings);
            }
        }, (error) => {
            console.error('Erro na sincronização de configurações:', error);
        });
    }

    function updateCloudStatus(status, text) {
        const badge = document.getElementById('cloud-status-badge');
        const dot = badge ? badge.querySelector('.cloud-dot') : null;
        const txt = document.getElementById('cloud-status-text');

        if (dot) {
            dot.className = 'cloud-dot';
            if (status === 'connecting') dot.classList.add('connecting');
            if (status === 'error') dot.classList.add('error');
        }
        if (txt) txt.textContent = text;
    }

    function refreshCurrentView() {
        const activePage = document.querySelector('.page.active');
        if (!activePage) return;
        const pageId = activePage.id.replace('page-', '');

        if (pageId === 'dashboard') renderDashboard();
        if (pageId === 'incomes') renderIncomesTable();
        if (pageId === 'trips') renderAllTripsTable();
        if (pageId === 'stores') renderStoresPage();
        if (pageId === 'maintenance') renderMaintenancePage();
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

        const btnMaint = document.getElementById('btn-view-maint');
        if (btnMaint) {
            btnMaint.addEventListener('click', () => {
                showPage('maintenance');
            });
        }
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
        if (pageId === 'stores') renderStoresPage();
        if (pageId === 'maintenance') renderMaintenancePage();
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

    function calcWearDetails(km, wearCost) {
        const costPerKm = (wearCost !== null && wearCost !== undefined && !isNaN(wearCost)) 
            ? wearCost 
            : (settings.wearCostPerKm || 0.45);
        if (!km || !costPerKm) return 0;
        return km * costPerKm;
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

        // Aggregate Expenses, KM, Times, Wear & Stores
        let totalKm = 0;
        let totalFuel = 0;
        let totalFood = 0;
        let totalToll = 0;
        let totalOther = 0;
        let totalWear = 0;
        let totalStores = 0;
        let totalWorkMinutes = 0;
        let totalDriveMinutes = 0;
        let totalServiceMinutes = 0;

        periodTrips.forEach(t => {
            const km = parseFloat(t.km) || 0;
            totalKm += km;
            totalFuel += calcFuelDetails(t.km, t.fuelPrice, t.kmPerLiter).cost;
            totalFood += parseFloat(t.food) || 0;
            totalToll += parseFloat(t.toll) || 0;
            totalOther += parseFloat(t.other) || 0;
            totalWear += calcWearDetails(km, t.wearCost);
            totalStores += (t.stores ? t.stores.length : 0);

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

        const storesEl = document.getElementById('stat-stores-count');
        if (storesEl) storesEl.textContent = totalStores;

        const wearEl = document.getElementById('stat-wear-total');
        if (wearEl) wearEl.textContent = currency(totalWear);

        // Check maintenance alerts
        checkMaintenanceAlerts();

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

            saveIncomeCloud(newIncome);
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
                    deleteIncomeCloud(b.dataset.id);
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

        // Live calculation triggers (KM, Preços, Desgaste e Horários)
        [
            'trip-km', 'trip-fuel-price', 'trip-km-per-liter', 'trip-wear-cost',
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
        document.getElementById('trip-wear-cost').placeholder = (settings.wearCostPerKm || 0.45).toFixed(2);
        document.getElementById('trip-wear-cost').value = '';

        // Reset times
        document.getElementById('trip-time-start').value = '';
        document.getElementById('trip-time-arrival').value = '';
        document.getElementById('trip-time-departure').value = '';
        document.getElementById('trip-time-end').value = '';

        // Reset stores
        currentTripStores = [];
        renderTripStoresChips();
        populateRegisteredStoresDatalist();

        // Reset expenses & tolls
        currentTripExpenses = [];
        renderTripExpensesList();
        document.getElementById('trip-toll').value = '';
        document.getElementById('trip-food').value = '';
        document.getElementById('trip-other').value = '';
        document.getElementById('trip-other-desc').value = '';

        updateTripLiveCalc();
    }

    function updateTripLiveCalc() {
        const km = parseFloat(document.getElementById('trip-km').value) || 0;
        const fuelPrice = parseFloat(document.getElementById('trip-fuel-price').value) || settings.fuelPrice;
        const kmPerLiter = parseFloat(document.getElementById('trip-km-per-liter').value) || settings.kmPerLiter;
        const wearCostInput = parseFloat(document.getElementById('trip-wear-cost').value);
        const food = parseFloat(document.getElementById('trip-food').value) || 0;
        const toll = parseFloat(document.getElementById('trip-toll').value) || 0;
        const other = parseFloat(document.getElementById('trip-other').value) || 0;

        const fuel = calcFuelDetails(km, fuelPrice, kmPerLiter);
        const wearCost = calcWearDetails(km, isNaN(wearCostInput) ? null : wearCostInput);

        document.getElementById('calc-liters').textContent = (fuel.liters).toFixed(1).replace('.', ',') + ' L';
        document.getElementById('calc-fuel-cost').textContent = currency(fuel.cost);
        document.getElementById('calc-wear-cost').textContent = currency(wearCost);
        document.getElementById('calc-car-total').textContent = currency(fuel.cost + wearCost);

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
            wearCost: parseFloat(document.getElementById('trip-wear-cost').value) || null,
            stores: [...currentTripStores],
            expenses: [...currentTripExpenses],
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

        saveTripCloud(trip);
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
        document.getElementById('trip-wear-cost').value = trip.wearCost || '';
        document.getElementById('trip-food').value = trip.food || '';
        document.getElementById('trip-toll').value = trip.toll || '';
        document.getElementById('trip-other').value = trip.other || '';
        document.getElementById('trip-other-desc').value = trip.otherDesc || '';
        document.getElementById('trip-notes').value = trip.notes || '';

        currentTripStores = trip.stores ? [...trip.stores] : [];
        renderTripStoresChips();

        if (trip.expenses && Array.isArray(trip.expenses)) {
            currentTripExpenses = [...trip.expenses];
        } else {
            currentTripExpenses = [];
            if (trip.toll > 0) {
                currentTripExpenses.push({ id: 't1', category: 'Pedágio', description: 'Pedágio Total', amount: trip.toll });
            }
            if (trip.food > 0) {
                currentTripExpenses.push({ id: 'f1', category: 'Alimentação', description: 'Alimentação', amount: trip.food });
            }
            if (trip.other > 0) {
                currentTripExpenses.push({ id: 'o1', category: 'Outros', description: trip.otherDesc || 'Outras Despesas', amount: trip.other });
            }
        }
        renderTripExpensesList();

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

            const tollExpenses = (t.expenses || []).filter(e => e.category === 'Pedágio');
            const tollCount = tollExpenses.length;
            const tollTooltip = tollExpenses.map(e => `${e.description}: ${currency(e.amount)}`).join(' | ');
            const tollDisplay = tollCount > 1 
                ? `<span title="${escapeHtml(tollTooltip)}" style="cursor:help;">${currency(t.toll)} <small style="display:block;color:#4338ca;font-size:0.75rem;font-weight:600;">(${tollCount} pedágios)</small></span>` 
                : currency(t.toll);

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
                <td>${tollDisplay}</td>
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
                    deleteTripCloud(b.dataset.id);
                    renderAllTripsTable();
                    renderDashboard();
                    showToast('Viagem excluída.');
                });
            });
        });
    }

    // ============================
    //  ROTA INTELIGENTE (GOOGLE MAPS & WAZE)
    // ============================
    function bindRouteButtons() {
        const btnGmaps = document.getElementById('btn-open-gmaps');
        const btnWaze = document.getElementById('btn-open-waze');

        if (btnGmaps) {
            btnGmaps.addEventListener('click', () => {
                const origin = document.getElementById('trip-origin').value.trim() || settings.defaultOrigin || '';
                const dest = document.getElementById('trip-destination').value.trim();

                if (!dest) {
                    showToast('Informe o destino da viagem primeiro!', true);
                    document.getElementById('trip-destination').focus();
                    return;
                }

                // If there are stores visited, include them as waypoints
                let waypointsStr = '';
                if (currentTripStores.length > 0) {
                    const storeStops = currentTripStores.map(s => `${s.name}, ${dest}`).join('|');
                    waypointsStr = `&waypoints=${encodeURIComponent(storeStops)}`;
                }

                let url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`;
                if (origin) url += `&origin=${encodeURIComponent(origin)}`;
                if (waypointsStr) url += waypointsStr;

                window.open(url, '_blank');
            });
        }

        if (btnWaze) {
            btnWaze.addEventListener('click', () => {
                const dest = document.getElementById('trip-destination').value.trim();
                if (!dest) {
                    showToast('Informe o destino da viagem primeiro!', true);
                    document.getElementById('trip-destination').focus();
                    return;
                }
                const url = `https://waze.com/ul?q=${encodeURIComponent(dest)}&navigate=yes`;
                window.open(url, '_blank');
            });
        }
    }

    // ============================
    //  LOJAS VISITADAS (SOLO VIVO)
    // ============================
    let currentStoresTab = 'routes'; // 'routes' ou 'history'

    function getStoreBadgeClass(type) {
        if (type === 'Hortifruti') return 'badge-horti';
        if (type === 'Empório Natural' || type === 'Produtos Naturais') return 'badge-emporio';
        if (type === 'Hipermercado' || type === 'Atacarejo') return 'badge-atacado';
        return 'badge-super';
    }

    function populateRegisteredStoresDatalist() {
        const datalist = document.getElementById('registered-stores-datalist');
        if (!datalist || !window.SOLO_VIVO_CATALOG) return;
        datalist.innerHTML = window.SOLO_VIVO_CATALOG.map(s => 
            `<option value="${escapeHtml(s.name)}">${escapeHtml(s.routeName)} - ${escapeHtml(s.city)} (${escapeHtml(s.type)})</option>`
        ).join('');
    }

    function bindStoresEvents() {
        populateRegisteredStoresDatalist();

        const btnAdd = document.getElementById('btn-add-store');
        if (btnAdd) {
            btnAdd.addEventListener('click', () => {
                const nameInput = document.getElementById('store-input-name');
                const typeInput = document.getElementById('store-input-type');
                const statusInput = document.getElementById('store-input-status');
                const orderInput = document.getElementById('store-input-order');

                const name = nameInput.value.trim();
                if (!name) {
                    showToast('Informe o nome da loja ou supermercado!', true);
                    nameInput.focus();
                    return;
                }

                currentTripStores.push({
                    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
                    name,
                    type: typeInput.value,
                    status: statusInput.value,
                    orderValue: parseFloat(orderInput.value) || 0
                });

                nameInput.value = '';
                orderInput.value = '';
                nameInput.focus();

                renderTripStoresChips();
                showToast(`Loja "${name}" adicionada ao roteiro!`);
            });
        }

        // Autocomplete listener: quando o usuário seleciona ou digita da lista oficial
        const nameInput = document.getElementById('store-input-name');
        if (nameInput) {
            nameInput.addEventListener('input', () => {
                const val = nameInput.value.trim().toLowerCase();
                if (!val || !window.SOLO_VIVO_CATALOG) return;
                const matched = window.SOLO_VIVO_CATALOG.find(c => c.name.toLowerCase() === val);
                if (matched) {
                    const typeInput = document.getElementById('store-input-type');
                    if (typeInput && matched.type) {
                        for (let opt of typeInput.options) {
                            if (opt.value.toLowerCase().includes(matched.type.toLowerCase()) || matched.type.toLowerCase().includes(opt.value.toLowerCase())) {
                                typeInput.value = opt.value;
                                break;
                            }
                        }
                    }
                    const destInput = document.getElementById('trip-dest');
                    if (destInput && !destInput.value && matched.city) {
                        destInput.value = matched.city;
                    }
                }
            });
        }

        // Botão para adicionar rota completa do dia de uma vez
        const btnAddRoute = document.getElementById('btn-add-entire-route');
        if (btnAddRoute) {
            btnAddRoute.addEventListener('click', () => {
                const routeSelect = document.getElementById('quick-route-select');
                const rId = routeSelect ? routeSelect.value : '';
                if (!rId) {
                    showToast('Selecione uma rota no campo ao lado primeiro!', true);
                    return;
                }

                const route = (window.SOLO_VIVO_ROUTES || []).find(r => r.id === rId);
                if (!route) return;

                let addedCount = 0;
                route.stores.forEach(s => {
                    if (!currentTripStores.some(cs => cs.name === s.name)) {
                        currentTripStores.push({
                            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
                            name: s.name,
                            type: s.type,
                            status: 'Pedido Realizado',
                            orderValue: 0
                        });
                        addedCount++;
                    }
                });

                const destInput = document.getElementById('trip-dest');
                if (destInput && (!destInput.value || destInput.value.trim() === '')) {
                    destInput.value = route.city || route.name;
                }

                renderTripStoresChips();
                showToast(`⚡ ${addedCount} lojas da rota "${route.name}" adicionadas ao seu roteiro!`);
            });
        }

        // Alternância de Abas na Página de Lojas (Rotas Cadastradas vs Histórico)
        const tabRoutes = document.getElementById('tab-btn-stores-routes');
        const tabHistory = document.getElementById('tab-btn-stores-history');

        if (tabRoutes && tabHistory) {
            tabRoutes.addEventListener('click', () => {
                currentStoresTab = 'routes';
                tabRoutes.classList.add('active');
                tabHistory.classList.remove('active');
                const routesView = document.getElementById('stores-routes-view');
                const historyView = document.getElementById('stores-history-view');
                const filters = document.getElementById('stores-history-filters');
                if (routesView) routesView.style.display = 'block';
                if (historyView) historyView.style.display = 'none';
                if (filters) filters.style.display = 'none';
                renderCatalogRoutes();
            });

            tabHistory.addEventListener('click', () => {
                currentStoresTab = 'history';
                tabHistory.classList.add('active');
                tabRoutes.classList.remove('active');
                const routesView = document.getElementById('stores-routes-view');
                const historyView = document.getElementById('stores-history-view');
                const filters = document.getElementById('stores-history-filters');
                if (routesView) routesView.style.display = 'none';
                if (historyView) historyView.style.display = 'block';
                if (filters) filters.style.display = 'flex';
                renderStoresHistoryTable();
            });
        }

        // Filtros da tabela de histórico
        const searchInput = document.getElementById('filter-stores-search');
        const typeSelect = document.getElementById('filter-stores-type');
        if (searchInput) searchInput.addEventListener('input', renderStoresHistoryTable);
        if (typeSelect) typeSelect.addEventListener('change', renderStoresHistoryTable);
    }

    function startTripWithRoute(routeId) {
        if (!window.SOLO_VIVO_ROUTES) return;
        const route = window.SOLO_VIVO_ROUTES.find(r => r.id === routeId);
        if (!route) return;

        showPage('new-trip');
        prepareNewTripForm();

        const destInput = document.getElementById('trip-dest');
        if (destInput) destInput.value = route.city || route.name;

        const purposeInput = document.getElementById('trip-purpose');
        if (purposeInput) purposeInput.value = `Atendimento Representação Solo Vivo: ${route.name}`;

        const quickSelect = document.getElementById('quick-route-select');
        if (quickSelect) quickSelect.value = route.id;

        // Pré-carrega todas as lojas da rota na viagem
        currentTripStores = route.stores.map(s => ({
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
            name: s.name,
            type: s.type,
            status: 'Pedido Realizado',
            orderValue: 0
        }));

        renderTripStoresChips();
        showToast(`🚗 Viagem iniciada com as ${route.stores.length} lojas da rota "${route.name}"!`);
    }

    function renderCatalogRoutes() {
        const container = document.getElementById('routes-cards-container');
        if (!container || !window.SOLO_VIVO_ROUTES) return;

        container.innerHTML = window.SOLO_VIVO_ROUTES.map(route => {
            const storesHtml = route.stores.map(s => `
                <div class="route-store-item">
                    <div class="route-store-name">
                        <span>${escapeHtml(s.name)}</span>
                        <span class="route-store-city">📍 ${escapeHtml(s.city)}</span>
                    </div>
                    <div class="route-store-meta">
                        <span class="badge-store-type ${getStoreBadgeClass(s.type)}">${escapeHtml(s.type)}</span>
                        ${s.rating ? `<span class="store-rating-badge">★ ${s.rating}</span>` : ''}
                    </div>
                </div>
            `).join('');

            return `
                <div class="route-card">
                    <div class="route-card-header">
                        <div>
                            <h3 class="route-card-title">🚗 ${escapeHtml(route.name)}</h3>
                            <span class="route-card-subtitle">${escapeHtml(route.subtitle || route.city)}</span>
                        </div>
                        <span class="route-badge-count">${route.stores.length} Lojas</span>
                    </div>
                    <div class="route-card-body">
                        ${storesHtml}
                    </div>
                    <div class="route-actions">
                        <a href="${route.mapsUrl}" target="_blank" rel="noopener noreferrer" class="btn-secondary btn-sm" style="flex: 1; text-align: center; text-decoration: none; display: flex; align-items: center; justify-content: center; gap: 4px;" title="Abrir lista oficial compartilhada no Google Maps">
                            🗺️ Google Maps ↗️
                        </a>
                        <button type="button" class="btn-primary btn-sm btn-start-route-trip" data-route-id="${route.id}" style="flex: 1.3;">
                            ⚡ Iniciar Viagem nesta Rota
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        container.querySelectorAll('.btn-start-route-trip').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const rId = e.currentTarget.dataset.routeId;
                startTripWithRoute(rId);
            });
        });
    }

    function renderTripStoresChips() {
        const container = document.getElementById('trip-stores-list');
        if (!container) return;

        if (currentTripStores.length === 0) {
            container.innerHTML = '<span class="empty-hint" id="no-stores-added-hint">Nenhuma loja adicionada nesta viagem ainda.</span>';
            return;
        }

        container.innerHTML = currentTripStores.map((s, idx) => `
            <div class="store-chip">
                <span><strong>${escapeHtml(s.name)}</strong> (${s.type} - ${s.status}${s.orderValue > 0 ? ` | Pedido: ${currency(s.orderValue)}` : ''})</span>
                <button type="button" class="store-chip-remove" data-idx="${idx}" title="Remover loja">&times;</button>
            </div>
        `).join('');

        container.querySelectorAll('.store-chip-remove').forEach(b => {
            b.addEventListener('click', (e) => {
                const idx = parseInt(e.currentTarget.dataset.idx, 10);
                currentTripStores.splice(idx, 1);
                renderTripStoresChips();
            });
        });
    }

    function renderStoresPage() {
        if (currentStoresTab === 'routes') {
            renderCatalogRoutes();
        } else {
            renderStoresHistoryTable();
        }
    }

    function renderStoresHistoryTable() {
        const search = (document.getElementById('filter-stores-search')?.value || '').toLowerCase();
        const typeFilter = document.getElementById('filter-stores-type')?.value || '';

        // Extrai todas as lojas de todas as viagens
        let allStores = [];
        trips.forEach(t => {
            if (t.stores && Array.isArray(t.stores)) {
                t.stores.forEach(s => {
                    allStores.push({
                        ...s,
                        tripDate: t.date,
                        tripRoute: t.origin ? `${t.origin} → ${t.destination}` : t.destination,
                        tripPurpose: t.purpose || ''
                    });
                });
            }
        });

        // Estatísticas gerais
        let totalOrders = 0;
        let superCount = 0;
        let hortiCount = 0;

        allStores.forEach(s => {
            totalOrders += (s.orderValue || 0);
            if (s.type === 'Supermercado') superCount++;
            if (s.type === 'Hortifruti') hortiCount++;
        });

        const statTotalEl = document.getElementById('stores-stat-total');
        if (statTotalEl) statTotalEl.textContent = allStores.length;
        const statSuperEl = document.getElementById('stores-stat-super');
        if (statSuperEl) statSuperEl.textContent = superCount;
        const statHortiEl = document.getElementById('stores-stat-horti');
        if (statHortiEl) statHortiEl.textContent = hortiCount;
        const statOrdersEl = document.getElementById('stores-stat-orders');
        if (statOrdersEl) statOrdersEl.textContent = currency(totalOrders);

        // Aplica filtros
        let filtered = allStores;
        if (search) {
            filtered = filtered.filter(s => 
                (s.name || '').toLowerCase().includes(search) || 
                (s.tripRoute || '').toLowerCase().includes(search) ||
                (s.status || '').toLowerCase().includes(search)
            );
        }

        if (typeFilter) {
            filtered = filtered.filter(s => s.type === typeFilter);
        }

        filtered.sort((a, b) => (b.tripDate || '').localeCompare(a.tripDate || ''));

        const tbody = document.querySelector('#stores-table tbody');
        const noMsg = document.getElementById('no-stores-msg');
        const table = document.getElementById('stores-table');

        if (!tbody) return;

        if (filtered.length === 0) {
            tbody.innerHTML = '';
            if (noMsg) noMsg.style.display = 'block';
            if (table) table.style.display = 'none';
            return;
        }

        if (noMsg) noMsg.style.display = 'none';
        if (table) table.style.display = '';

        tbody.innerHTML = filtered.map(s => {
            const badgeClass = getStoreBadgeClass(s.type);
            return `<tr>
                <td>${fmtDate(s.tripDate)}</td>
                <td><strong>${escapeHtml(s.name)}</strong></td>
                <td><span class="badge-store-type ${badgeClass}">${escapeHtml(s.type)}</span></td>
                <td>${escapeHtml(s.tripRoute)}</td>
                <td><span style="font-weight:600;color:#065f46;">${escapeHtml(s.status)}</span></td>
                <td style="font-weight:600;color:var(--primary);">${s.orderValue > 0 ? currency(s.orderValue) : '-'}</td>
                <td><small style="color:var(--text-muted);">${escapeHtml(s.tripPurpose || '-')}</small></td>
            </tr>`;
        }).join('');
    }

    // ============================
    //  LANÇAMENTO DE GASTOS & PEDÁGIOS
    // ============================
    function bindExpenseItemsEvents() {
        const btnAdd = document.getElementById('btn-add-expense');
        const amountInput = document.getElementById('expense-input-amount');
        const descInput = document.getElementById('expense-input-desc');

        if (btnAdd) {
            btnAdd.addEventListener('click', addExpenseItemFromInputs);
        }

        if (amountInput) {
            amountInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    addExpenseItemFromInputs();
                }
            });
        }

        if (descInput) {
            descInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    amountInput.focus();
                }
            });
        }
    }

    function addExpenseItemFromInputs() {
        const catSelect = document.getElementById('expense-input-cat');
        const descInput = document.getElementById('expense-input-desc');
        const amountInput = document.getElementById('expense-input-amount');

        const cat = catSelect.value;
        let desc = descInput.value.trim();
        const amount = parseFloat(amountInput.value);

        if (isNaN(amount) || amount <= 0) {
            showToast('Informe um valor de gasto válido maior que zero!', true);
            amountInput.focus();
            return;
        }

        if (!desc) {
            if (cat === 'Pedágio') {
                const count = currentTripExpenses.filter(e => e.category === 'Pedágio').length + 1;
                desc = `Pedágio Praça ${count}`;
            } else {
                desc = cat;
            }
        }

        currentTripExpenses.push({
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
            category: cat,
            description: desc,
            amount: amount
        });

        descInput.value = '';
        amountInput.value = '';
        catSelect.value = 'Pedágio'; // mantem pedágio pronto para o próximo
        descInput.focus();

        recalculateSubtotalsFromExpenses();
        renderTripExpensesList();
        updateTripLiveCalc();
        showToast(`✅ ${cat} de ${currency(amount)} adicionado!`);
    }

    function recalculateSubtotalsFromExpenses() {
        if (currentTripExpenses.length === 0) return;

        let tollTotal = 0;
        let foodTotal = 0;
        let otherTotal = 0;
        let otherDescriptions = [];

        currentTripExpenses.forEach(e => {
            if (e.category === 'Pedágio') {
                tollTotal += (e.amount || 0);
            } else if (e.category === 'Alimentação') {
                foodTotal += (e.amount || 0);
            } else {
                otherTotal += (e.amount || 0);
                if (e.description) otherDescriptions.push(e.description);
            }
        });

        document.getElementById('trip-toll').value = tollTotal > 0 ? tollTotal.toFixed(2) : '';
        document.getElementById('trip-food').value = foodTotal > 0 ? foodTotal.toFixed(2) : '';
        document.getElementById('trip-other').value = otherTotal > 0 ? otherTotal.toFixed(2) : '';
        document.getElementById('trip-other-desc').value = otherDescriptions.join(', ');
    }

    function renderTripExpensesList() {
        const container = document.getElementById('trip-expenses-container');
        if (!container) return;

        if (currentTripExpenses.length === 0) {
            container.innerHTML = '<span class="empty-hint" id="no-expenses-hint">Nenhum pedágio ou despesa avulsa adicionada. Lance cada um conforme passar!</span>';
            return;
        }

        container.innerHTML = currentTripExpenses.map((e, idx) => {
            let catClass = 'expense-cat-other';
            let icon = '📦';
            if (e.category === 'Pedágio') { catClass = 'expense-cat-toll'; icon = '🛣️'; }
            else if (e.category === 'Alimentação') { catClass = 'expense-cat-food'; icon = '🍽️'; }
            else if (e.category === 'Estacionamento') { catClass = 'expense-cat-parking'; icon = '🅿️'; }
            else if (e.category === 'Hospedagem') { catClass = 'expense-cat-hotel'; icon = '🏨'; }

            return `
                <div class="expense-item-chip">
                    <div class="expense-chip-left">
                        <span class="expense-chip-cat ${catClass}">${icon} ${escapeHtml(e.category)}</span>
                        <span><strong>${escapeHtml(e.description || '-')}</strong></span>
                    </div>
                    <div class="expense-chip-right">
                        <span class="expense-chip-val">${currency(e.amount)}</span>
                        <button type="button" class="expense-chip-remove" data-idx="${idx}" title="Remover gasto">&times;</button>
                    </div>
                </div>
            `;
        }).join('');

        container.querySelectorAll('.expense-chip-remove').forEach(b => {
            b.addEventListener('click', (ev) => {
                const idx = parseInt(ev.currentTarget.dataset.idx, 10);
                currentTripExpenses.splice(idx, 1);
                recalculateSubtotalsFromExpenses();
                if (currentTripExpenses.length === 0) {
                    document.getElementById('trip-toll').value = '';
                    document.getElementById('trip-food').value = '';
                    document.getElementById('trip-other').value = '';
                }
                renderTripExpensesList();
                updateTripLiveCalc();
            });
        });
    }

    // ============================
    //  MANUTENÇÃO & DESGASTE DO CARRO
    // ============================
    const MAINTENANCE_RULES = [
        { key: 'oilChange', title: 'Troca de Óleo e Filtro', interval: 10000, icon: '🛢️', desc: 'Essencial para a vida útil do motor' },
        { key: 'tireRotation', title: 'Alinhamento & Rodízio de Pneus', interval: 10000, icon: '🛞', desc: 'Evita desgaste irregular e melhora a frenagem' },
        { key: 'brakes', title: 'Pastilhas de Freio & Fluidos', interval: 25000, icon: '🛑', desc: 'Segurança e eficiência na frenagem' },
        { key: 'tires', title: 'Troca de Pneus', interval: 45000, icon: '🚘', desc: 'Substituição completa do jogo de pneus' },
        { key: 'generalReview', title: 'Revisão Geral do Carro', interval: 50000, icon: '⚙️', desc: 'Correias, suspensão, velas e filtros' }
    ];

    function calculateVehicleMetrics() {
        const totalWorkKm = trips.reduce((acc, t) => acc + (parseFloat(t.km) || 0), 0);
        const currentOdometer = (settings.carOdometer || 85000) + totalWorkKm;
        const maintenanceFund = totalWorkKm * (settings.wearCostPerKm || 0.45);

        return { totalWorkKm, currentOdometer, maintenanceFund };
    }

    function checkMaintenanceAlerts() {
        const { currentOdometer } = calculateVehicleMetrics();
        const banner = document.getElementById('maint-alert-banner');
        const msg = document.getElementById('maint-alert-msg');
        if (!banner || !msg) return;

        let warningItems = [];

        MAINTENANCE_RULES.forEach(rule => {
            const lastKm = (settings.maintenanceHistory && settings.maintenanceHistory[rule.key]) || settings.carOdometer || 80000;
            const kmSince = Math.max(0, currentOdometer - lastKm);
            const remaining = rule.interval - kmSince;

            if (remaining <= 0) {
                warningItems.push(`${rule.title} (VENCIDA há ${Math.abs(remaining).toFixed(0)} km!)`);
            } else if (remaining <= 1500) {
                warningItems.push(`${rule.title} (falta apenas ${remaining.toFixed(0)} km)`);
            }
        });

        if (warningItems.length > 0) {
            banner.style.display = 'flex';
            msg.textContent = warningItems.join(' | ');
        } else {
            banner.style.display = 'none';
        }
    }

    function renderMaintenancePage() {
        const { totalWorkKm, currentOdometer, maintenanceFund } = calculateVehicleMetrics();

        const odoEl = document.getElementById('maint-odometer');
        if (odoEl) odoEl.textContent = (currentOdometer).toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + ' km';

        const workKmEl = document.getElementById('maint-total-work-km');
        if (workKmEl) workKmEl.textContent = (totalWorkKm).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' km';

        const fundEl = document.getElementById('maint-fund-total');
        if (fundEl) fundEl.textContent = currency(maintenanceFund);

        const container = document.getElementById('maint-grid-container');
        if (!container) return;

        container.innerHTML = MAINTENANCE_RULES.map(rule => {
            const lastKm = (settings.maintenanceHistory && settings.maintenanceHistory[rule.key]) || settings.carOdometer || 80000;
            const kmSince = Math.max(0, currentOdometer - lastKm);
            const pct = Math.min(100, (kmSince / rule.interval) * 100);
            const remaining = rule.interval - kmSince;

            let statusClass = 'status-ok';
            let fillClass = 'fill-ok';
            let statusText = 'Em dia';

            if (remaining <= 0) {
                statusClass = 'status-danger';
                fillClass = 'fill-danger';
                statusText = 'VENCIDO!';
            } else if (remaining <= 1500) {
                statusClass = 'status-warning';
                fillClass = 'fill-warning';
                statusText = 'Atenção';
            }

            return `
                <div class="maint-card">
                    <div>
                        <div class="maint-card-header">
                            <span class="maint-title">${rule.icon} ${rule.title}</span>
                            <span class="maint-status-badge ${statusClass}">${statusText}</span>
                        </div>
                        <p class="maint-desc">${rule.desc}</p>
                        <div class="maint-progress-wrap">
                            <div class="maint-progress-label">
                                <span>${kmSince.toFixed(0)} km rodados</span>
                                <span>Limite: ${rule.interval.toLocaleString('pt-BR')} km</span>
                            </div>
                            <div class="maint-progress-bar">
                                <div class="maint-progress-fill ${fillClass}" style="width: ${pct}%"></div>
                            </div>
                            <small class="hint" style="display:block;margin-top:0.4rem;">
                                ${remaining > 0 ? `Restam ${remaining.toFixed(0)} km até a próxima manutenção` : `Passou do prazo por ${Math.abs(remaining).toFixed(0)} km!`}
                            </small>
                        </div>
                    </div>
                    <button type="button" class="btn-maint-action" data-key="${rule.key}" data-title="${rule.title}">
                        ✔️ Registrar Realização Hoje
                    </button>
                </div>
            `;
        }).join('');

        container.querySelectorAll('.btn-maint-action').forEach(b => {
            b.addEventListener('click', () => {
                const key = b.dataset.key;
                const title = b.dataset.title;
                showConfirm('Registrar Manutenção', `Confirmar que realizou a "${title}" no odômetro atual (${currentOdometer.toFixed(0)} km)? O contador será reiniciado.`, () => {
                    if (!settings.maintenanceHistory) settings.maintenanceHistory = {};
                    settings.maintenanceHistory[key] = currentOdometer;
                    saveSettings();
                    renderMaintenancePage();
                    checkMaintenanceAlerts();
                    showToast(`Manutenção "${title}" atualizada com sucesso!`);
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

            const odoInput = parseFloat(document.getElementById('cfg-odometer').value);
            if (!isNaN(odoInput)) settings.carOdometer = odoInput;

            const wearInput = parseFloat(document.getElementById('cfg-wear-cost').value);
            if (!isNaN(wearInput)) settings.wearCostPerKm = wearInput;

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

                        const alreadyExists = incomes.some(i => i.date === targetDate);
                        if (!alreadyExists) {
                            const newInc = {
                                id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                                date: targetDate,
                                amount,
                                category: 'Adiantamento Dia 15',
                                description: settings.defaultIncomeDesc || 'Adiantamento Viagens - Dia 15',
                                createdAt: new Date().toISOString()
                            };
                            incomes.push(newInc);
                            saveIncomeCloud(newInc);
                            createdCount++;
                        }
                    }
                    saveIncomesLocal();
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

        const odoEl = document.getElementById('cfg-odometer');
        if (odoEl) odoEl.value = settings.carOdometer || 85000;

        const wearEl = document.getElementById('cfg-wear-cost');
        if (wearEl) wearEl.value = settings.wearCostPerKm || 0.45;
    }

    // ============================
    //  EXPORT & BACKUP
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
                            const newInc = {
                                id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                                date: targetDate,
                                amount,
                                category: 'Adiantamento Dia 15',
                                description: settings.defaultIncomeDesc || 'Adiantamento Viagens - Dia 15',
                                createdAt: new Date().toISOString()
                            };
                            incomes.push(newInc);
                            saveIncomeCloud(newInc);
                            createdCount++;
                        }
                    }
                    saveIncomesLocal();
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
            'Origem', 'Destino', 'Motivo', 'Lojas_Visitadas', 'KM', 'Preco_Combustivel',
            'Media_KM_L', 'Litros_Gastos', 'Custo_Combustivel', 'Desgaste_Carro_R$',
            'Alimentacao', 'Pedagios', 'Pedagios_Discriminados', 'Outros', 'Descricao_Outros', 'Total_Reembolso', 'Total_Real_Operacional', 'Observacoes'
        ].join(sep));

        trips.slice().sort((a,b) => (a.date || '').localeCompare(b.date || '')).forEach(t => {
            const fuel = calcFuelDetails(t.km, t.fuelPrice, t.kmPerLiter);
            const wear = calcWearDetails(t.km, t.wearCost);
            const total = calcTripTotal(t);
            const times = calcTripTimes(t);
            const storesNames = (t.stores || []).map(s => `${s.name} (${s.type})`).join(' | ');
            const tollItems = (t.expenses || []).filter(e => e.category === 'Pedágio').map(e => `${e.description} (R$ ${e.amount.toFixed(2)})`).join(' + ');

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
                `"${storesNames.replace(/"/g, '""')}"`,
                (t.km || 0).toFixed(1).replace('.', ','),
                (t.fuelPrice || settings.fuelPrice).toFixed(2).replace('.', ','),
                (t.kmPerLiter || settings.kmPerLiter).toFixed(1).replace('.', ','),
                (fuel.liters).toFixed(2).replace('.', ','),
                (fuel.cost).toFixed(2).replace('.', ','),
                (wear).toFixed(2).replace('.', ','),
                (t.food || 0).toFixed(2).replace('.', ','),
                (t.toll || 0).toFixed(2).replace('.', ','),
                `"${tollItems.replace(/"/g, '""')}"`,
                (t.other || 0).toFixed(2).replace('.', ','),
                `"${(t.otherDesc || '').replace(/"/g, '""')}"`,
                (total).toFixed(2).replace('.', ','),
                (total + wear).toFixed(2).replace('.', ','),
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
