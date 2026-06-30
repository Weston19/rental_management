
// ========== CONFIGURATION ==========
const API_URL = '/api';
const UPLOAD_URL = '/api/upload';
let token = localStorage.getItem('token');
let currentView = 'dashboard';
let currentFinancialView = 'summary';
let currentPage = 1;
let itemsPerPage = 10;
let currentData = [];

// ========== HELPER FUNCTIONS ==========
async function apiCall(endpoint, options = {}) {
    const defaultOptions = {
        headers: {
            'Content-Type': 'application/json',
            ...(token && { 'Authorization': `Bearer ${token}` })
        }
    };
    
    try {
        const response = await fetch(`${API_URL}${endpoint}`, { ...defaultOptions, ...options });
        
        if (response.status === 401) {
            localStorage.removeItem('token');
            token = null;
            renderAuth();
            return null;
        }
        
        const data = await response.json();
        return data;
    } catch (error) {
        return null;
    }
}

async function uploadImage(file, type) {
    const formData = new FormData();
    formData.append('image', file);
    
    const response = await fetch(`${UPLOAD_URL}/${type}`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`
        },
        body: formData
    });
    
    const data = await response.json();
    return data.imageUrl;
}

function showModal(html, onSave) {
    const existingModal = document.querySelector('.modal');
    if (existingModal) existingModal.remove();
    
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'flex';
    modal.innerHTML = html;
    document.body.appendChild(modal);
    
    const closeModal = () => modal.remove();
    
    modal.querySelector('#closeModalBtn')?.addEventListener('click', closeModal);
    modal.querySelector('#saveModalBtn')?.addEventListener('click', async () => {
        if (onSave) await onSave();
        closeModal();
    });
    
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });
}

function showPasswordModal(title, message, callback) {
    const modalHtml = `
        <div class="modal-content" style="max-width:400px;">
            <h3>${title}</h3>
            <p style="color:#666; font-size:14px;">${message}</p>
            <label>Enter Password</label>
            <input type="password" id="passwordInput" placeholder="Enter your password">
            <div class="modal-buttons">
                <button class="btn-cancel" id="closeModalBtn">Cancel</button>
                <button class="btn-save" id="confirmPasswordBtn">Confirm</button>
            </div>
        </div>
    `;
    showModal(modalHtml, null);
    setTimeout(() => {
        const confirmBtn = document.getElementById('confirmPasswordBtn');
        if (confirmBtn) {
            confirmBtn.onclick = () => {
                const password = document.getElementById('passwordInput').value;
                if (!password) {
                    alert('Please enter your password');
                    return;
                }
                const modal = document.querySelector('.modal');
                if (modal) modal.remove();
                callback(password);
            };
        }
    }, 100);
}

function formatNumber(num) {
    if (num === undefined || num === null) return '0';
    return Number(num).toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatDate(dateString) {
    if (!dateString) return '-';
    return dateString.split('T')[0];
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ========== PAGINATION FUNCTIONS ==========
function renderPagination(containerId, totalItems, onPageChange) {
    const totalPages = Math.ceil(totalItems / itemsPerPage);
    const container = document.getElementById(containerId);
    if (!container) return;
    
    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }
    
    let html = '<div class="pagination">';
    html += `<button class="prev-page" ${currentPage === 1 ? 'disabled' : ''}>« Previous</button>`;
    html += `<span class="page-info">Page ${currentPage} of ${totalPages}</span>`;
    html += `<button class="next-page" ${currentPage === totalPages ? 'disabled' : ''}>Next »</button>`;
    html += '</div>';
    container.innerHTML = html;
    
    const prevBtn = container.querySelector('.prev-page');
    const nextBtn = container.querySelector('.next-page');
    
    if (prevBtn) {
        prevBtn.onclick = () => {
            if (currentPage > 1) {
                currentPage--;
                onPageChange();
            }
        };
    }
    
    if (nextBtn) {
        nextBtn.onclick = () => {
            if (currentPage < totalPages) {
                currentPage++;
                onPageChange();
            }
        };
    }
}

function getPaginatedData(data) {
    const start = (currentPage - 1) * itemsPerPage;
    const end = start + itemsPerPage;
    return data.slice(start, end);
}

// ========== AUTH RENDERING ==========
function renderAuth() {
    const app = document.getElementById('app');
    app.innerHTML = `
        <div class="auth-container">
            <div class="auth-card">
                <h2 id="authTitle">Login</h2>
                <div id="authForm">
                    <input type="email" id="email" placeholder="Email" autocomplete="off">
                    <input type="password" id="password" placeholder="Password" autocomplete="off">
                    <div id="companyField" style="display:none">
                        <input type="text" id="company_name" placeholder="Company Name" autocomplete="off">
                    </div>
                    <button id="authBtn">Login</button>
                </div>
                <div class="switch" id="switchAuth">Don't have an account? Sign up</div>
                <div id="authError" class="error"></div>
            </div>
        </div>
    `;

    let isLogin = true;

    document.getElementById('switchAuth').onclick = () => {
        isLogin = !isLogin;
        document.getElementById('authTitle').innerText = isLogin ? 'Login' : 'Sign Up';
        document.getElementById('authBtn').innerText = isLogin ? 'Login' : 'Sign Up';
        document.getElementById('companyField').style.display = isLogin ? 'none' : 'block';
        document.getElementById('switchAuth').innerText = isLogin ? "Don't have an account? Sign up" : "Already have an account? Login";
    };

    document.getElementById('authBtn').onclick = async () => {
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const company_name = document.getElementById('company_name')?.value;

        if (!email || !password) {
            document.getElementById('authError').innerText = 'Please fill all fields';
            return;
        }

        if (!isLogin && !company_name) {
            document.getElementById('authError').innerText = 'Please enter company name';
            return;
        }

        const endpoint = isLogin ? '/auth/login' : '/auth/signup';
        const body = isLogin ? { email, password } : { email, password, company_name };

        try {
            const response = await fetch(`${API_URL}${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            const data = await response.json();
            if (response.ok) {
                token = data.token;
                localStorage.setItem('token', token);
                localStorage.setItem('companyName', data.admin?.company_name || 'Rental System');
                renderMainApp(data.admin?.company_name || 'Rental System');
            } else {
                document.getElementById('authError').innerText = data.error || 'Authentication failed';
            }
        } catch (error) {
            document.getElementById('authError').innerText = 'Connection error. Is the backend running?';
        }
    };
}

// ========== MAIN APP RENDERING WITH SIDEBAR ==========
function renderMainApp(companyName) {
    const app = document.getElementById('app');
    app.innerHTML = `
        <div class="app-header">
            <div class="company-name">${escapeHtml(companyName)}</div>
            <button class="logout-btn" id="logoutBtn">Logout</button>
        </div>
        <div class="app-layout">
            <div class="sidebar" id="sidebar">
                <button class="sidebar-toggle" id="sidebarToggle">◀</button>
                <ul class="sidebar-menu">
                    <li data-view="dashboard" class="${currentView === 'dashboard' ? 'active' : ''}">
                        <i class="fas fa-tachometer-alt"></i> <span>Dashboard</span>
                    </li>
                    <li data-view="properties" class="${currentView === 'properties' ? 'active' : ''}">
                        <i class="fas fa-building"></i> <span>Properties</span>
                    </li>
                    <li data-view="rooms" class="${currentView === 'rooms' ? 'active' : ''}">
                        <i class="fas fa-door-open"></i> <span>Rooms</span>
                    </li>
                    <li data-view="tenants" class="${currentView === 'tenants' ? 'active' : ''}">
                        <i class="fas fa-users"></i> <span>Tenants</span>
                    </li>
                    <li data-view="billing" class="${currentView === 'billing' ? 'active' : ''}">
                        <i class="fas fa-file-invoice-dollar"></i> <span>Billing</span>
                    </li>
                    <li data-view="payments" class="${currentView === 'payments' ? 'active' : ''}">
                        <i class="fas fa-credit-card"></i> <span>Payments</span>
                    </li>
                    <li data-view="financials" class="${currentView === 'financials' ? 'active' : ''}">
                        <i class="fas fa-chart-line"></i> <span>Financials</span>
                    </li>
                    <li data-view="notifications" class="${currentView === 'notifications' ? 'active' : ''}">
                        <i class="fas fa-envelope"></i> <span>Notifications</span>
                        <span id="notifBadge" style="background:#e74c3c; color:white; border-radius:50%; padding:1px 8px; font-size:10px; margin-left:auto; display:none;">0</span>
                    </li>
                    <li data-view="settings" class="${currentView === 'settings' ? 'active' : ''}">
                        <i class="fas fa-cog"></i> <span>Settings</span>
                    </li>
                </ul>
            </div>
            <div class="main-content-area" id="content"></div>
        </div>
    `;

    document.getElementById('logoutBtn').onclick = () => {
        localStorage.removeItem('token');
        token = null;
        renderAuth();
    };
    
    // Sidebar toggle
    const sidebar = document.getElementById('sidebar');
    const toggleBtn = document.getElementById('sidebarToggle');
    toggleBtn.onclick = () => {
        sidebar.classList.toggle('collapsed');
        toggleBtn.innerHTML = sidebar.classList.contains('collapsed') ? '▶' : '◀';
    };

    document.querySelectorAll('.sidebar-menu li').forEach(li => {
        li.onclick = () => {
            currentView = li.getAttribute('data-view');
            currentPage = 1;
            renderMainApp(companyName);
        };
    });

    if (currentView === 'dashboard') renderDashboard();
    else if (currentView === 'properties') renderProperties();
    else if (currentView === 'rooms') renderRooms();
    else if (currentView === 'tenants') renderTenants();
    else if (currentView === 'billing') renderBilling();
    else if (currentView === 'payments') renderPayments();
    else if (currentView === 'financials') renderFinancials();
    else if (currentView === 'notifications') renderNotifications();
    else if (currentView === 'settings') renderSettings();
}

// ========== DASHBOARD ==========
async function renderDashboard() {
    const content = document.getElementById('content');
    
    // Get data
    const properties = await apiCall('/properties');
    const allRooms = await apiCall('/rooms');
    const allTenants = await apiCall('/tenants/all');
    const allBills = await apiCall('/bills');
    const allPayments = await apiCall('/payments');
    const allExpenses = await apiCall('/financials/expenses');
    
    // Calculate arrears
    let arrearsTotal = 0;
    let tenantsWithArrears = 0;
    let arrearsList = [];
    
    if (allTenants) {
        for (const tenant of allTenants) {
            const balanceResult = await apiCall(`/bills/tenant-balance/${tenant.id}`);
            const balance = balanceResult?.balance || 0;
            tenant.balance = balance;
            if (balance > 0) {
                arrearsTotal += balance;
                tenantsWithArrears++;
                arrearsList.push(tenant);
            }
        }
    }
    
    // Calculate advance payments
    let advanceTotal = 0;
    let tenantsWithAdvance = 0;
    let advanceList = [];
    
    if (allTenants) {
        for (const tenant of allTenants) {
            const balance = tenant.balance || 0;
            if (balance < 0) {
                advanceTotal += Math.abs(balance);
                tenantsWithAdvance++;
                advanceList.push(tenant);
            }
        }
    }
    
    // Calculate payments & invoices totals
    let totalBilled = 0;
    let totalPaid = 0;
    if (allBills) {
        totalBilled = allBills.reduce((sum, b) => sum + parseFloat(b.total_bill || 0), 0);
        totalPaid = allBills.reduce((sum, b) => sum + parseFloat(b.total_paid || 0), 0);
    }
    const paidPercentage = totalBilled > 0 ? Math.round((totalPaid / totalBilled) * 100) : 0;
    const unpaidPercentage = 100 - paidPercentage;
    
    // Calculate occupancy
    const totalRooms = allRooms ? allRooms.length : 0;
    const vacantRooms = allRooms ? allRooms.filter(r => r.status === 'vacant').length : 0;
    const occupiedRooms = totalRooms - vacantRooms;
    const occupancyRate = totalRooms > 0 ? Math.round((occupiedRooms / totalRooms) * 100) : 0;
    
    // Calculate property breakdowns for modals
    let propertyInvoiceData = [];
    let propertyOccupancyData = [];
    
    if (properties) {
        for (const property of properties) {
            const propertyRooms = allRooms ? allRooms.filter(r => r.property_id === property.id) : [];
            const propertyTenants = allTenants ? allTenants.filter(t => t.property_id === property.id && !t.is_deleted) : [];
            
            let pBilled = 0;
            let pPaid = 0;
            for (const tenant of propertyTenants) {
                const tenantBills = allBills ? allBills.filter(b => b.tenant_id === tenant.id) : [];
                for (const bill of tenantBills) {
                    pBilled += parseFloat(bill.total_bill || 0);
                    pPaid += parseFloat(bill.total_paid || 0);
                }
            }
            
            propertyInvoiceData.push({
                id: property.id,
                name: property.name,
                totalBilled: pBilled,
                totalPaid: pPaid,
                collectionRate: pBilled > 0 ? Math.round((pPaid / pBilled) * 100) : 0
            });
            
            propertyOccupancyData.push({
                id: property.id,
                name: property.name,
                total: propertyRooms.length,
                vacant: propertyRooms.filter(r => r.status === 'vacant').length,
                occupied: propertyRooms.filter(r => r.status === 'occupied').length,
                occupancyRate: propertyRooms.length > 0 ? Math.round((propertyRooms.filter(r => r.status === 'occupied').length / propertyRooms.length) * 100) : 0
            });
        }
    }
    
    // Chart data (last 6 months)
    const today = new Date();
    const chartData = [];
    for (let i = 5; i >= 0; i--) {
        const date = new Date(today.getFullYear(), today.getMonth() - i, 1);
        const monthStr = date.toLocaleDateString('en-GB', { month: 'short' });
        const monthYear = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        
        let payments = 0;
        let invoices = 0;
        let expenses = 0;
        
        if (allPayments) {
            payments = allPayments
                .filter(p => p.payment_date && p.payment_date.startsWith(monthYear))
                .reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);
        }
        if (allBills) {
            invoices = allBills
                .filter(b => b.bill_month && b.bill_month.startsWith(monthYear))
                .reduce((sum, b) => sum + parseFloat(b.total_bill || 0), 0);
        }
        if (allExpenses) {
            expenses = allExpenses
                .filter(e => e.expense_date && e.expense_date.startsWith(monthYear))
                .reduce((sum, e) => sum + parseFloat(e.amount || 0), 0);
        }
        
        chartData.push({ month: monthStr, payments, invoices, expenses });
    }
    
    // Render Dashboard
    content.innerHTML = `
        <div class="dashboard-container">
            <!-- 4 Cards -->
            <div class="dashboard-cards">
                <!-- Card 1: Arrears -->
                <div class="dashboard-card clickable" id="arrearsCard">
                    <h4>Tenant Arrears (KES)</h4>
                    <div class="card-value" style="color:#e74c3c;">KES ${formatNumber(arrearsTotal)}</div>
                    <div class="card-sub">${tenantsWithArrears} tenant${tenantsWithArrears > 1 ? 's' : ''} with arrears</div>
                </div>
                
                <!-- Card 2: Advance Payments -->
                <div class="dashboard-card clickable" id="advanceCard">
                    <h4>Tenant Advance Payments (KES)</h4>
                    <div class="card-value" style="color:#27ae60;">KES ${formatNumber(advanceTotal)}</div>
                    <div class="card-sub">${tenantsWithAdvance} tenant${tenantsWithAdvance > 1 ? 's' : ''} with advance payments</div>
                </div>
                
                <!-- Card 3: Payments & Invoices (Pie Chart) -->
                <div class="dashboard-card clickable" id="paymentsCard">
                    <h4>Payments & Invoices</h4>
                    <div class="pie-container">
                        <canvas id="paymentsPieChart" width="80" height="80"></canvas>
                        <div class="pie-labels">
                            <div class="pie-label">
                                <span class="pie-dot green"></span> Paid: ${paidPercentage}%
                            </div>
                            <div class="pie-label">
                                <span class="pie-dot red"></span> Unpaid: ${unpaidPercentage}%
                            </div>
                            <div class="pie-totals">
                                <span>Billed: KES ${formatNumber(totalBilled)}</span>
                                <span>Paid: KES ${formatNumber(totalPaid)}</span>
                            </div>
                        </div>
                    </div>
                </div>
                
                <!-- Card 4: Occupancy (Pie Chart) -->
                <div class="dashboard-card clickable" id="occupancyCard">
                    <h4>Occupancy</h4>
                    <div class="pie-container">
                        <canvas id="occupancyPieChart" width="80" height="80"></canvas>
                        <div class="pie-labels">
                            <div class="pie-label">
                                <span class="pie-dot green"></span> Occupied: ${occupancyRate}%
                            </div>
                            <div class="pie-label">
                                <span class="pie-dot grey"></span> Vacant: ${100 - occupancyRate}%
                            </div>
                            <div class="pie-totals">
                                <span>Total: ${totalRooms}</span>
                                <span>Occupied: ${occupiedRooms}</span>
                                <span>Vacant: ${vacantRooms}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- Chart -->
            <div class="chart-section">
                <h3>Monthly Overview (Last 6 Months)</h3>
                <div class="chart-wrapper">
                    <canvas id="dashboardChart"></canvas>
                </div>
            </div>
        </div>
    `;
    
    // ========== RENDER PIE CHARTS ==========
    setTimeout(() => {
        renderPieChart('paymentsPieChart', paidPercentage, unpaidPercentage, ['#5cb85c', '#e74c3c']);
        renderPieChart('occupancyPieChart', occupancyRate, 100 - occupancyRate, ['#5cb85c', '#95a5a6']);
    }, 100);
    
    // ========== RENDER BAR CHART ==========
    setTimeout(() => {
        renderChart(chartData);
    }, 200);
    
    // ========== ATTACH EVENT LISTENERS ==========
    document.getElementById('arrearsCard').onclick = () => {
        showArrearsModal(arrearsList);
    };
    
    document.getElementById('advanceCard').onclick = () => {
        showAdvanceModal(advanceList);
    };
    
    document.getElementById('paymentsCard').onclick = () => {
        showInvoiceBreakdownModal(propertyInvoiceData);
    };
    
    document.getElementById('occupancyCard').onclick = () => {
        showOccupancyBreakdownModal(propertyOccupancyData);
    };
}

// ========== PIE CHART HELPER ==========
function renderPieChart(canvasId, value1, value2, colors) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = 32;
    
    ctx.clearRect(0, 0, width, height);
    
    // Calculate angles
    const angle1 = (value1 / 100) * 2 * Math.PI;
    
    // Draw segment 1
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius, -Math.PI / 2, -Math.PI / 2 + angle1);
    ctx.closePath();
    ctx.fillStyle = colors[0];
    ctx.fill();
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 2;
    ctx.stroke();
    
    // Draw segment 2
    if (value2 > 0) {
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.arc(centerX, centerY, radius, -Math.PI / 2 + angle1, -Math.PI / 2 + 2 * Math.PI);
        ctx.closePath();
        ctx.fillStyle = colors[1];
        ctx.fill();
        ctx.stroke();
    }
    
    // Center text
    ctx.fillStyle = '#333';
    ctx.font = 'bold 12px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${value1}%`, centerX, centerY);
}

// ========== BAR CHART HELPER ==========
function renderChart(chartData) {
    const canvas = document.getElementById('dashboardChart');
    if (!canvas) {
        return;
    }
    
    const ctx = canvas.getContext('2d');
    
    // Destroy existing chart if any
    if (window.dashboardChartInstance) {
        window.dashboardChartInstance.destroy();
    }
    
    // Check if there's any data
    const hasData = chartData.some(d => d.payments > 0 || d.invoices > 0 || d.expenses > 0);
    
    if (!hasData) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#999';
        ctx.font = '16px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('No data available for chart', canvas.width/2, canvas.height/2);
        return;
    }
    
    const labels = chartData.map(d => d.month);
    const paymentsData = chartData.map(d => d.payments);
    const invoicesData = chartData.map(d => d.invoices);
    const expensesData = chartData.map(d => d.expenses);
    
    window.dashboardChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Total Payments',
                    data: paymentsData,
                    backgroundColor: 'rgba(74, 144, 217, 0.7)',
                    borderColor: '#4a90d9',
                    borderWidth: 1
                },
                {
                    label: 'Total Invoices',
                    data: invoicesData,
                    backgroundColor: 'rgba(92, 184, 92, 0.7)',
                    borderColor: '#5cb85c',
                    borderWidth: 1
                },
                {
                    label: 'Total Expenses',
                    data: expensesData,
                    backgroundColor: 'rgba(231, 76, 60, 0.7)',
                    borderColor: '#e74c3c',
                    borderWidth: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    labels: { font: { size: 12 } }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return 'KES ' + formatNumber(value);
                        }
                    }
                }
            }
        }
    });
}

// ========== ARREARS MODAL ==========
function showArrearsModal(arrearsList) {
    let rowsHtml = '';
    arrearsList.forEach(t => {
        rowsHtml += `
            <tr>
                <td>${escapeHtml(t.first_name)} ${escapeHtml(t.last_name)}</td>
                <td>${escapeHtml(t.phone)}</td>
                <td>${escapeHtml(t.house_no || '-')}</td>
                <td style="color:#e74c3c; font-weight:bold;">KES ${formatNumber(t.balance)}</td>
                <td><button class="btn-edit" onclick="sendReminderToTenant(${t.id}, '${escapeHtml(t.first_name)} ${escapeHtml(t.last_name)}', ${t.balance})">Remind</button></td>
            </tr>
        `;
    });
    
    const totalArrears = arrearsList.reduce((sum, t) => sum + (t.balance || 0), 0);
    
    const modalHtml = `
        <div class="modal-content" style="max-width:700px;">
            <h3>Tenant Arrears</h3>
            <div class="table-wrapper">
                <table>
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Phone</th>
                            <th>Unit</th>
                            <th>Balance</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml}</tbody>
                    <tfoot>
                        <tr style="background:#f0f0f0; font-weight:bold;">
                            <td colspan="3">TOTAL ARREARS</td>
                            <td style="color:#e74c3c;">KES ${formatNumber(totalArrears)}</td>
                            <td></td>
                        </tr>
                    </tfoot>
                </table>
            </div>
            <div class="modal-buttons">
                <button class="btn-cancel" id="closeModalBtn">Close</button>
            </div>
        </div>
    `;
    
    showModal(modalHtml, null);
}

// ========== ADVANCE MODAL ==========
function showAdvanceModal(advanceList) {
    let rowsHtml = '';
    advanceList.forEach(t => {
        rowsHtml += `
            <tr>
                <td>${escapeHtml(t.first_name)} ${escapeHtml(t.last_name)}</td>
                <td>${escapeHtml(t.phone)}</td>
                <td>${escapeHtml(t.house_no || '-')}</td>
                <td style="color:#27ae60; font-weight:bold;">KES ${formatNumber(Math.abs(t.balance))}</td>
            </tr>
        `;
    });
    
    const totalAdvance = advanceList.reduce((sum, t) => sum + Math.abs(t.balance || 0), 0);
    
    const modalHtml = `
        <div class="modal-content" style="max-width:700px;">
            <h3>Tenant Advance Payments</h3>
            <div class="table-wrapper">
                <table>
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Phone</th>
                            <th>Unit</th>
                            <th>Advance Amount</th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml}</tbody>
                    <tfoot>
                        <tr style="background:#f0f0f0; font-weight:bold;">
                            <td colspan="3">TOTAL ADVANCE</td>
                            <td style="color:#27ae60;">KES ${formatNumber(totalAdvance)}</td>
                        </tr>
                    </tfoot>
                </table>
            </div>
            <div class="modal-buttons">
                <button class="btn-cancel" id="closeModalBtn">Close</button>
            </div>
        </div>
    `;
    
    showModal(modalHtml, null);
}

// ========== INVOICE BREAKDOWN MODAL ==========
function showInvoiceBreakdownModal(propertyInvoiceData) {
    let rowsHtml = '';
    let grandBilled = 0;
    let grandPaid = 0;
    
    propertyInvoiceData.forEach(p => {
        grandBilled += p.totalBilled;
        grandPaid += p.totalPaid;
        rowsHtml += `
            <tr>
                <td>${escapeHtml(p.name)}</td>
                <td>KES ${formatNumber(p.totalBilled)}</td>
                <td>KES ${formatNumber(p.totalPaid)}</td>
                <td>${p.collectionRate}%</td>
            </tr>
        `;
    });
    
    const modalHtml = `
        <div class="modal-content" style="max-width:700px;">
            <h3>Payments & Invoices - Property Breakdown</h3>
            <div class="table-wrapper">
                <table>
                    <thead>
                        <tr>
                            <th>Property</th>
                            <th>Total Billed</th>
                            <th>Total Paid</th>
                            <th>Collection Rate</th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml}</tbody>
                    <tfoot>
                        <tr style="background:#f0f0f0; font-weight:bold;">
                            <td>TOTAL</td>
                            <td>KES ${formatNumber(grandBilled)}</td>
                            <td>KES ${formatNumber(grandPaid)}</td>
                            <td>${grandBilled > 0 ? Math.round((grandPaid / grandBilled) * 100) : 0}%</td>
                        </tr>
                    </tfoot>
                </table>
            </div>
            <div class="modal-buttons">
                <button class="btn-cancel" id="closeModalBtn">Close</button>
            </div>
        </div>
    `;
    
    showModal(modalHtml, null);
}

// ========== OCCUPANCY BREAKDOWN MODAL ==========
function showOccupancyBreakdownModal(propertyOccupancyData) {
    let rowsHtml = '';
    let totalUnits = 0;
    let totalVacant = 0;
    let totalOccupied = 0;
    
    propertyOccupancyData.forEach(p => {
        totalUnits += p.total;
        totalVacant += p.vacant;
        totalOccupied += p.occupied;
        rowsHtml += `
            <tr>
                <td>${escapeHtml(p.name)}</td>
                <td>${p.total}</td>
                <td>${p.vacant}</td>
                <td>${p.occupied}</td>
                <td>${p.occupancyRate}%</td>
            </tr>
        `;
    });
    
    const modalHtml = `
        <div class="modal-content" style="max-width:700px;">
            <h3>Occupancy - Property Breakdown</h3>
            <div class="table-wrapper">
                <table>
                    <thead>
                        <tr>
                            <th>Property</th>
                            <th>Total Units</th>
                            <th>Vacant</th>
                            <th>Occupied</th>
                            <th>Occupancy %</th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml}</tbody>
                    <tfoot>
                        <tr style="background:#f0f0f0; font-weight:bold;">
                            <td>TOTAL</td>
                            <td>${totalUnits}</td>
                            <td>${totalVacant}</td>
                            <td>${totalOccupied}</td>
                            <td>${totalUnits > 0 ? Math.round((totalOccupied / totalUnits) * 100) : 0}%</td>
                        </tr>
                    </tfoot>
                </table>
            </div>
            <div class="modal-buttons">
                <button class="btn-cancel" id="closeModalBtn">Close</button>
            </div>
        </div>
    `;
    
    showModal(modalHtml, null);
}

// ========== SEND REMINDER TO TENANT ==========
window.sendReminderToTenant = async (tenantId, tenantName, balance) => {
    const templates = await apiCall('/settings/templates');
    let reminderTemplate = null;
    if (templates) {
        reminderTemplate = templates.find(t => t.name === 'rent_reminder');
    }
    
    const defaultMessage = `Hello {name}, this is to remind you that your rent payment of {month} amount {balance} is due on {due_date}. Please make payment on time to avoid penalties.`;
    const templateText = reminderTemplate?.template_text || defaultMessage;
    
    const today = new Date();
    const monthStr = today.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    const dueDate = new Date(today.getFullYear(), today.getMonth(), 5).toISOString().split('T')[0];
    
    const message = templateText
        .replace(/{name}/g, tenantName)
        .replace(/{month}/g, monthStr)
        .replace(/{balance}/g, formatNumber(balance))
        .replace(/{due_date}/g, dueDate);
    
    if (confirm(`Send reminder to ${tenantName}?\n\n${message}`)) {
        const result = await apiCall('/messages/send', {
            method: 'POST',
            body: JSON.stringify({
                recipient_type: 'tenant',
                recipient_id: tenantId,
                subject: 'Rent Reminder',
                message: message
            })
        });
        
        if (result?.error) {
            alert('Error: ' + result.error);
        } else {
            alert('Reminder sent successfully!');
        }
    }
};

// ========== MODAL FUNCTIONS ==========

// Show Arrears Breakdown Modal
function showArrearsModal(arrearsList) {
    let rowsHtml = '';
    arrearsList.forEach(t => {
        rowsHtml += `
            <tr>
                <td>${escapeHtml(t.first_name)} ${escapeHtml(t.last_name)}</td>
                <td>${escapeHtml(t.house_no || '-')}</td>
                <td>${escapeHtml(t.property_name || '-')}</td>
                <td style="color:#e74c3c; font-weight:bold;">KES ${formatNumber(t.balance)}</td>
            </tr>
        `;
    });
    
    const totalArrears = arrearsList.reduce((sum, t) => sum + (t.balance || 0), 0);
    
    const modalHtml = `
        <div class="modal-content" style="max-width:600px;">
            <h3>Tenant Arrears Breakdown</h3>
            <div class="table-wrapper">
                <table>
                    <thead>
                        <tr>
                            <th>Tenant</th>
                            <th>Unit</th>
                            <th>Property</th>
                            <th>Balance</th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml}</tbody>
                    <tfoot>
                        <tr style="background:#f0f0f0; font-weight:bold;">
                            <td colspan="3">TOTAL ARREARS</td>
                            <td style="color:#e74c3c;">KES ${formatNumber(totalArrears)}</td>
                        </tr>
                    </tfoot>
                </table>
            </div>
            <div class="modal-buttons">
                <button class="btn-cancel" id="closeModalBtn">Close</button>
            </div>
        </div>
    `;
    
    showModal(modalHtml, null);
}

// Show Advance Payments Breakdown Modal
function showAdvanceModal(advanceList) {
    let rowsHtml = '';
    advanceList.forEach(t => {
        rowsHtml += `
            <tr>
                <td>${escapeHtml(t.first_name)} ${escapeHtml(t.last_name)}</td>
                <td>${escapeHtml(t.house_no || '-')}</td>
                <td>${escapeHtml(t.property_name || '-')}</td>
                <td style="color:#27ae60; font-weight:bold;">KES ${formatNumber(Math.abs(t.balance))}</td>
            </tr>
        `;
    });
    
    const totalAdvance = advanceList.reduce((sum, t) => sum + Math.abs(t.balance || 0), 0);
    
    const modalHtml = `
        <div class="modal-content" style="max-width:600px;">
            <h3>Tenant Advance Payments Breakdown</h3>
            <div class="table-wrapper">
                <table>
                    <thead>
                        <tr>
                            <th>Tenant</th>
                            <th>Unit</th>
                            <th>Property</th>
                            <th>Advance Amount</th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml}</tbody>
                    <tfoot>
                        <tr style="background:#f0f0f0; font-weight:bold;">
                            <td colspan="3">TOTAL ADVANCE</td>
                            <td style="color:#27ae60;">KES ${formatNumber(totalAdvance)}</td>
                        </tr>
                    </tfoot>
                </table>
            </div>
            <div class="modal-buttons">
                <button class="btn-cancel" id="closeModalBtn">Close</button>
            </div>
        </div>
    `;
    
    showModal(modalHtml, null);
}

// Show Invoice Breakdown by Property
function showInvoiceBreakdown(properties, allBills, allPayments) {
    let rowsHtml = '';
    let grandTotalBilled = 0;
    let grandTotalPaid = 0;
    
    if (properties) {
        for (const property of properties) {
            let totalBilled = 0;
            let totalPaid = 0;
            
            // Get bills for this property
            const propertyBills = allBills ? allBills.filter(b => b.property_id === property.id) : [];
            for (const bill of propertyBills) {
                totalBilled += parseFloat(bill.total_bill) || 0;
                totalPaid += parseFloat(bill.total_paid) || 0;
            }
            
            grandTotalBilled += totalBilled;
            grandTotalPaid += totalPaid;
            
            rowsHtml += `
                <tr>
                    <td>${escapeHtml(property.name)}</td>
                    <td>KES ${formatNumber(totalBilled)}</td>
                    <td>KES ${formatNumber(totalPaid)}</td>
                    <td>${totalBilled > 0 ? Math.round((totalPaid / totalBilled) * 100) : 0}%</td>
                </tr>
            `;
        }
    }
    
    const modalHtml = `
        <div class="modal-content" style="max-width:600px;">
            <h3>Invoice Breakdown by Property</h3>
            <div class="table-wrapper">
                <table>
                    <thead>
                        <tr>
                            <th>Property</th>
                            <th>Total Billed</th>
                            <th>Total Paid</th>
                            <th>Collection Rate</th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml}</tbody>
                    <tfoot>
                        <tr style="background:#f0f0f0; font-weight:bold;">
                            <td>TOTAL</td>
                            <td>KES ${formatNumber(grandTotalBilled)}</td>
                            <td>KES ${formatNumber(grandTotalPaid)}</td>
                            <td>${grandTotalBilled > 0 ? Math.round((grandTotalPaid / grandTotalBilled) * 100) : 0}%</td>
                        </tr>
                    </tfoot>
                </table>
            </div>
            <div class="modal-buttons">
                <button class="btn-cancel" id="closeModalBtn">Close</button>
            </div>
        </div>
    `;
    
    showModal(modalHtml, null);
}

// Show Occupancy Breakdown by Property
function showOccupancyBreakdown(properties, allRooms) {
    let rowsHtml = '';
    let totalVacant = 0;
    let totalOccupied = 0;
    
    if (properties) {
        for (const property of properties) {
            const propertyRooms = allRooms ? allRooms.filter(r => r.property_id === property.id) : [];
            const vacant = propertyRooms.filter(r => r.status === 'vacant').length;
            const occupied = propertyRooms.filter(r => r.status === 'occupied').length;
            const total = propertyRooms.length;
            
            totalVacant += vacant;
            totalOccupied += occupied;
            
            rowsHtml += `
                <tr>
                    <td>${escapeHtml(property.name)}</td>
                    <td>${total}</td>
                    <td>${vacant}</td>
                    <td>${occupied}</td>
                    <td>${total > 0 ? Math.round((occupied / total) * 100) : 0}%</td>
                </tr>
            `;
        }
    }
    
    const totalRooms = totalVacant + totalOccupied;
    const occupancyRate = totalRooms > 0 ? Math.round((totalOccupied / totalRooms) * 100) : 0;
    
    const modalHtml = `
        <div class="modal-content" style="max-width:600px;">
            <h3>Occupancy Breakdown by Property</h3>
            <div class="table-wrapper">
                <table>
                    <thead>
                        <tr>
                            <th>Property</th>
                            <th>Total Units</th>
                            <th>Vacant</th>
                            <th>Occupied</th>
                            <th>Occupancy %</th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml}</tbody>
                    <tfoot>
                        <tr style="background:#f0f0f0; font-weight:bold;">
                            <td>TOTAL</td>
                            <td>${totalRooms}</td>
                            <td>${totalVacant}</td>
                            <td>${totalOccupied}</td>
                            <td>${occupancyRate}%</td>
                        </tr>
                    </tfoot>
                </table>
            </div>
            <div class="modal-buttons">
                <button class="btn-cancel" id="closeModalBtn">Close</button>
            </div>
        </div>
    `;
    
    showModal(modalHtml, null);
}

// Show Insights Modal (All in One)
function showInsightsModal(arrearsList, advanceList, properties, allBills, allPayments, allRooms) {
    // Build arrears section
    let arrearsHtml = '';
    if (arrearsList.length > 0) {
        arrearsList.slice(0, 5).forEach(t => {
            arrearsHtml += `
                <tr>
                    <td>${escapeHtml(t.first_name)} ${escapeHtml(t.last_name)}</td>
                    <td>${escapeHtml(t.house_no || '-')}</td>
                    <td style="color:#e74c3c;">KES ${formatNumber(t.balance)}</td>
                </tr>
            `;
        });
        if (arrearsList.length > 5) {
            arrearsHtml += `<tr><td colspan="3" style="text-align:center;color:#888;">+ ${arrearsList.length - 5} more tenants</td></tr>`;
        }
    } else {
        arrearsHtml = `<tr><td colspan="3" style="text-align:center;color:#888;">No tenants with arrears</td></tr>`;
    }
    
    // Build advance section
    let advanceHtml = '';
    if (advanceList.length > 0) {
        advanceList.slice(0, 5).forEach(t => {
            advanceHtml += `
                <tr>
                    <td>${escapeHtml(t.first_name)} ${escapeHtml(t.last_name)}</td>
                    <td>${escapeHtml(t.house_no || '-')}</td>
                    <td style="color:#27ae60;">KES ${formatNumber(Math.abs(t.balance))}</td>
                </tr>
            `;
        });
        if (advanceList.length > 5) {
            advanceHtml += `<tr><td colspan="3" style="text-align:center;color:#888;">+ ${advanceList.length - 5} more tenants</td></tr>`;
        }
    } else {
        advanceHtml = `<tr><td colspan="3" style="text-align:center;color:#888;">No tenants with advance payments</td></tr>`;
    }
    
    // Build invoice section
    let invoiceHtml = '';
    let grandTotalBilled = 0;
    let grandTotalPaid = 0;
    if (properties) {
        properties.slice(0, 5).forEach(p => {
            let totalBilled = 0;
            let totalPaid = 0;
            const propBills = allBills ? allBills.filter(b => b.property_id === p.id) : [];
            for (const bill of propBills) {
                totalBilled += parseFloat(bill.total_bill) || 0;
                totalPaid += parseFloat(bill.total_paid) || 0;
            }
            grandTotalBilled += totalBilled;
            grandTotalPaid += totalPaid;
            invoiceHtml += `
                <tr>
                    <td>${escapeHtml(p.name)}</td>
                    <td>KES ${formatNumber(totalBilled)}</td>
                    <td>KES ${formatNumber(totalPaid)}</td>
                </tr>
            `;
        });
        if (properties.length > 5) {
            invoiceHtml += `<tr><td colspan="3" style="text-align:center;color:#888;">+ ${properties.length - 5} more properties</td></tr>`;
        }
    }
    
    // Build occupancy section
    let occupancyHtml = '';
    let totalVacant = 0;
    let totalOccupied = 0;
    if (properties) {
        properties.slice(0, 5).forEach(p => {
            const propRooms = allRooms ? allRooms.filter(r => r.property_id === p.id) : [];
            const vacant = propRooms.filter(r => r.status === 'vacant').length;
            const occupied = propRooms.filter(r => r.status === 'occupied').length;
            totalVacant += vacant;
            totalOccupied += occupied;
            occupancyHtml += `
                <tr>
                    <td>${escapeHtml(p.name)}</td>
                    <td>${vacant}</td>
                    <td>${occupied}</td>
                </tr>
            `;
        });
        if (properties.length > 5) {
            occupancyHtml += `<tr><td colspan="3" style="text-align:center;color:#888;">+ ${properties.length - 5} more properties</td></tr>`;
        }
    }
    
    const modalHtml = `
        <div class="modal-content" style="max-width:700px; max-height:85vh; overflow-y:auto;">
            <h3>Insights Overview</h3>
            
            <h4 style="margin-top:15px; color:#e74c3c;">🔴 Tenant Arrears</h4>
            <div class="table-wrapper">
                <table>
                    <thead><tr><th>Tenant</th><th>Unit</th><th>Balance</th></tr></thead>
                    <tbody>${arrearsHtml}</tbody>
                </table>
            </div>
            
            <h4 style="margin-top:15px; color:#27ae60;">🟢 Tenant Advance Payments</h4>
            <div class="table-wrapper">
                <table>
                    <thead><tr><th>Tenant</th><th>Unit</th><th>Advance Amount</th></tr></thead>
                    <tbody>${advanceHtml}</tbody>
                </table>
            </div>
            
            <h4 style="margin-top:15px; color:#4a90d9;">📄 Invoice Summary by Property</h4>
            <div class="table-wrapper">
                <table>
                    <thead><tr><th>Property</th><th>Total Billed</th><th>Total Paid</th></tr></thead>
                    <tbody>${invoiceHtml}</tbody>
                    <tfoot><tr style="background:#f0f0f0;font-weight:bold;"><td>TOTAL</td><td>KES ${formatNumber(grandTotalBilled)}</td><td>KES ${formatNumber(grandTotalPaid)}</td></tr></tfoot>
                </table>
            </div>
            
            <h4 style="margin-top:15px; color:#f39c12;">🏠 Occupancy Summary</h4>
            <div class="table-wrapper">
                <table>
                    <thead><tr><th>Property</th><th>Vacant</th><th>Occupied</th></tr></thead>
                    <tbody>${occupancyHtml}</tbody>
                    <tfoot><tr style="background:#f0f0f0;font-weight:bold;"><td>TOTAL</td><td>${totalVacant}</td><td>${totalOccupied}</td></tr></tfoot>
                </table>
            </div>
            
            <div class="modal-buttons">
                <button class="btn-cancel" id="closeModalBtn">Close</button>
            </div>
        </div>
    `;
    
    showModal(modalHtml, null);
}

// Send Arrears Reminders
async function sendArrearsReminders(arrearsList) {
    if (arrearsList.length === 0) {
        alert('No tenants with arrears to remind');
        return;
    }
    
    // Get the reminder template
    const templates = await apiCall('/settings/templates');
    let reminderTemplate = null;
    if (templates) {
        reminderTemplate = templates.find(t => t.name === 'rent_reminder');
    }
    
    const defaultMessage = `Hello {name}, this is to remind you that your rent payment of {month} amount {balance} is due on {due_date}. Please make payment on time to avoid penalties.`;
    const templateText = reminderTemplate?.template_text || defaultMessage;
    
    const today = new Date();
    const monthStr = today.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    const dueDate = new Date(today.getFullYear(), today.getMonth(), 5).toISOString().split('T')[0];
    
    let recipients = [];
    for (const tenant of arrearsList) {
        const balance = tenant.balance || 0;
        const message = templateText
            .replace(/{name}/g, `${tenant.first_name} ${tenant.last_name}`)
            .replace(/{month}/g, monthStr)
            .replace(/{balance}/g, formatNumber(balance))
            .replace(/{due_date}/g, dueDate);
        
        recipients.push({
            tenant_id: tenant.id,
            phone: tenant.phone,
            name: `${tenant.first_name} ${tenant.last_name}`,
            message: message
        });
    }
    
    // Show confirmation
    const recipientList = recipients.map(r => `${r.name} (${r.phone})`).join('\n');
    if (!confirm(`Send reminders to ${recipients.length} tenants?\n\n${recipientList}`)) {
        return;
    }
    
    // Send reminders
    let sent = 0;
    let failed = 0;
    
    for (const recipient of recipients) {
        // Store the message in the messages table
        const result = await apiCall('/messages/send', {
            method: 'POST',
            body: JSON.stringify({
                recipient_type: 'tenant',
                recipient_id: recipient.tenant_id,
                subject: 'Rent Reminder',
                message: recipient.message
            })
        });
        
        if (result?.error) {
            failed++;
        } else {
            sent++;
        }
    }
    
    alert(`Reminders sent: ${sent}, Failed: ${failed}`);
}

// ========== SETTINGS ==========
async function renderSettings() {
    const content = document.getElementById('content');
    content.innerHTML = `
        <h2>Settings</h2>
        <div style="display:flex; gap:10px; margin-bottom:20px; flex-wrap:wrap;">
            <button class="btn-add" id="changePasswordBtn">Change Password</button>
            <button class="btn-add" id="changeCompanyBtn" style="background:#3498db;">Change Company Name</button>
            <button class="btn-add" id="smsTemplatesBtn" style="background:#5cb85c;">SMS Templates</button>
        </div>
        <div id="settingsContent"><p>Select an option above to manage settings.</p></div>
    `;
    
    document.getElementById('changePasswordBtn').onclick = () => showChangePasswordModal();
    document.getElementById('changeCompanyBtn').onclick = () => showChangeCompanyModal();
    document.getElementById('smsTemplatesBtn').onclick = () => renderSmsTemplates();
}

// ========== CHANGE PASSWORD ==========
function showChangePasswordModal() {
    const modalHtml = `
        <div class="modal-content" style="max-width:400px;">
            <h3>Change Password</h3>
            <label>Current Password</label>
            <input type="password" id="oldPwd" placeholder="Enter current password">
            <label>New Password</label>
            <input type="password" id="newPwd" placeholder="Enter new password">
            <label>Confirm Password</label>
            <input type="password" id="confirmPwd" placeholder="Confirm new password">
            <div id="pwdMsg" style="color:#e74c3c; font-size:13px; margin-top:5px;"></div>
            <div class="modal-buttons">
                <button class="btn-cancel" id="closeModalBtn">Cancel</button>
                <button class="btn-save" id="savePwdBtn">Update Password</button>
            </div>
        </div>
    `;
    
    showModal(modalHtml, null);
    
    setTimeout(() => {
        document.getElementById('savePwdBtn').onclick = async () => {
            const oldPwd = document.getElementById('oldPwd').value;
            const newPwd = document.getElementById('newPwd').value;
            const confirmPwd = document.getElementById('confirmPwd').value;
            const msg = document.getElementById('pwdMsg');
            
            if (!oldPwd || !newPwd || !confirmPwd) {
                msg.textContent = 'Please fill all fields';
                return;
            }
            if (newPwd !== confirmPwd) {
                msg.textContent = 'New passwords do not match';
                return;
            }
            if (newPwd.length < 4) {
                msg.textContent = 'Password must be at least 4 characters';
                return;
            }
            
            const result = await apiCall('/settings/change-password', {
                method: 'PUT',
                body: JSON.stringify({ old_password: oldPwd, new_password: newPwd })
            });
            
            if (result?.error) {
                msg.textContent = result.error;
            } else {
                msg.style.color = '#27ae60';
                msg.textContent = '✅ Password updated successfully!';
                setTimeout(() => {
                    document.querySelector('.modal')?.remove();
                }, 1500);
            }
        };
    }, 100);
}

// ========== CHANGE COMPANY NAME ==========
function showChangeCompanyModal() {
    const modalHtml = `
        <div class="modal-content" style="max-width:400px;">
            <h3>Change Company Name</h3>
            <label>New Company Name</label>
            <input type="text" id="newCompanyName" placeholder="Enter new company name">
            <div id="companyMsg" style="color:#e74c3c; font-size:13px; margin-top:5px;"></div>
            <div class="modal-buttons">
                <button class="btn-cancel" id="closeModalBtn">Cancel</button>
                <button class="btn-save" id="saveCompanyBtn">Update</button>
            </div>
        </div>
    `;
    
    showModal(modalHtml, null);
    
    setTimeout(() => {
        document.getElementById('saveCompanyBtn').onclick = async () => {
            const name = document.getElementById('newCompanyName').value.trim();
            const msg = document.getElementById('companyMsg');
            
            if (!name) {
                msg.textContent = 'Please enter company name';
                return;
            }
            
            const result = await apiCall('/settings/update-company', {
                method: 'PUT',
                body: JSON.stringify({ company_name: name })
            });
            
            if (result?.error) {
                msg.textContent = result.error;
            } else {
                localStorage.setItem('companyName', name);
                msg.style.color = '#27ae60';
                msg.textContent = '✅ Company name updated successfully!';
                setTimeout(() => {
                    document.querySelector('.modal')?.remove();
                    renderMainApp(name);
                }, 1500);
            }
        };
    }, 100);
}


// ========== RENDER SMS TEMPLATES ==========
async function renderSmsTemplates() {
    const container = document.getElementById('settingsContent');
    
    try {
        const templates = await apiCall('/settings/templates');
        
        container.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; flex-wrap:wrap; gap:10px;">
                <h3>SMS Templates</h3>
                <div style="display:flex; gap:10px; flex-wrap:wrap;">
                    <button class="btn-add" id="addTemplateBtn">+ Add Template</button>
                    <button class="btn-add" id="resetTemplatesBtn" style="background:#e74c3c;">Reset to Defaults</button>
                </div>
            </div>
            <div id="templatesList">
                ${templates && templates.length > 0 ? templates.map(t => `
                    <div style="background:white; border:1px solid #e0e0e0; border-radius:8px; padding:15px; margin-bottom:15px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
                            <strong style="font-size:14px;">${escapeHtml(t.name)}</strong>
                            <div>
                                <button class="btn-edit" onclick="editTemplate(${t.id})">Edit</button>
                                <button class="btn-danger" onclick="deleteTemplate(${t.id})">Delete</button>
                            </div>
                        </div>
                        <p style="color:#555; font-size:13px; margin-top:8px; background:#f8f8f8; padding:10px; border-radius:4px; white-space:pre-wrap; word-wrap:break-word;">${escapeHtml(t.template_text)}</p>
                        ${t.description ? `<small style="color:#888;">${escapeHtml(t.description)}</small>` : ''}
                    </div>
                `).join('') : '<div class="empty-state">No templates found. Click "+ Add Template" to create one.</div>'}
            </div>
        `;
        
        document.getElementById('addTemplateBtn').onclick = () => showAddTemplateModal();
        document.getElementById('resetTemplatesBtn').onclick = async () => {
            if (confirm('Reset all templates to defaults? This cannot be undone.')) {
                const result = await apiCall('/settings/templates/reset', { method: 'POST' });
                if (result?.error) {
                    alert('Error: ' + result.error);
                } else {
                    alert('Templates reset successfully!');
                    renderSmsTemplates();
                }
            }
        };
        
        // Make edit/delete functions global
        window.editTemplate = async (id) => {
            const template = await apiCall(`/settings/templates/${id}`);
            if (!template) return;
            
            const modalHtml = `
                <div class="modal-content" style="max-width:500px;">
                    <h3>Edit Template</h3>
                    <label>Template Name</label>
                    <input type="text" id="editTemplateName" value="${escapeHtml(template.name)}">
                    <label>Template Text</label>
                    <textarea id="editTemplateText" rows="5">${escapeHtml(template.template_text)}</textarea>
                    <label>Description (Optional)</label>
                    <input type="text" id="editTemplateDesc" value="${escapeHtml(template.description || '')}">
                    <div id="editTemplateMsg" style="color:#e74c3c; font-size:13px; margin-top:5px;"></div>
                    <div class="modal-buttons">
                        <button class="btn-cancel" id="closeModalBtn">Cancel</button>
                        <button class="btn-save" id="saveTemplateBtn">Save Template</button>
                    </div>
                </div>
            `;
            
            showModal(modalHtml, null);
            
            setTimeout(() => {
                document.getElementById('saveTemplateBtn').onclick = async () => {
                    const name = document.getElementById('editTemplateName').value.trim();
                    const text = document.getElementById('editTemplateText').value.trim();
                    const desc = document.getElementById('editTemplateDesc').value.trim();
                    const msg = document.getElementById('editTemplateMsg');
                    
                    if (!name || !text) {
                        msg.textContent = 'Please fill all required fields';
                        return;
                    }
                    
                    const result = await apiCall(`/settings/templates/${id}`, {
                        method: 'PUT',
                        body: JSON.stringify({
                            name: name,
                            template_text: text,
                            description: desc || ''
                        })
                    });
                    
                    if (result?.error) {
                        msg.textContent = result.error;
                    } else {
                        msg.style.color = '#27ae60';
                        msg.textContent = '✅ Template updated successfully!';
                        setTimeout(() => {
                            document.querySelector('.modal')?.remove();
                            renderSmsTemplates();
                        }, 1500);
                    }
                };
            }, 100);
        };
        
        window.deleteTemplate = async (id) => {
            if (confirm('Delete this template?')) {
                const result = await apiCall(`/settings/templates/${id}`, { method: 'DELETE' });
                if (result?.error) {
                    alert('Error: ' + result.error);
                } else {
                    alert('Template deleted successfully!');
                    renderSmsTemplates();
                }
            }
        };
        
    } catch (error) {
        container.innerHTML = '<div class="empty-state">Error loading templates. Please try again.</div>';
    }
}

// ========== SHOW ADD TEMPLATE MODAL ==========
function showAddTemplateModal() {
    const modalHtml = `
        <div class="modal-content" style="max-width:500px;">
            <h3>Add Template</h3>
            <label>Template Name (unique identifier)</label>
            <input type="text" id="newTemplateName" placeholder="e.g., warning_template">
            <label>Template Text</label>
            <textarea id="newTemplateText" rows="5" placeholder="Hello {name}, this is a warning..."></textarea>
            <label>Description (Optional)</label>
            <input type="text" id="newTemplateDesc" placeholder="e.g., Used for warning messages">
            <div id="templateMsg" style="color:#e74c3c; font-size:13px; margin-top:5px;"></div>
            <div class="modal-buttons">
                <button class="btn-cancel" id="closeModalBtn">Cancel</button>
                <button class="btn-save" id="saveTemplateBtn">Add Template</button>
            </div>
        </div>
    `;
    
    showModal(modalHtml, null);
    
    setTimeout(() => {
        document.getElementById('saveTemplateBtn').onclick = async () => {
            const name = document.getElementById('newTemplateName').value.trim();
            const text = document.getElementById('newTemplateText').value.trim();
            const desc = document.getElementById('newTemplateDesc').value.trim();
            const msg = document.getElementById('templateMsg');
            
            if (!name) {
                msg.textContent = 'Please enter a template name';
                return;
            }
            if (!text) {
                msg.textContent = 'Please enter template text';
                return;
            }
            
            msg.textContent = '';
            msg.style.color = '#e74c3c';
            
            try {
                const result = await apiCall('/settings/templates', {
                    method: 'POST',
                    body: JSON.stringify({
                        name: name,
                        template_text: text,
                        description: desc || ''
                    })
                });
                
                if (result?.error) {
                    msg.textContent = result.error;
                } else {
                    msg.style.color = '#27ae60';
                    msg.textContent = '✅ Template added successfully!';
                    setTimeout(() => {
                        document.querySelector('.modal')?.remove();
                        renderSmsTemplates();
                    }, 1500);
                }
            } catch (error) {
                msg.textContent = 'Connection error. Please try again.';
            }
        };
    }, 100);
}

// ========== NOTIFICATIONS ==========
async function renderNotifications() {
    const content = document.getElementById('content');
    const balanceData = await apiCall('/settings/sms-balance');
    const balance = balanceData?.balance || '0.00';
    const messages = await apiCall('/messages');
    
    content.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; flex-wrap:wrap; gap:10px;">
            <div>
                <h2>Notifications</h2>
                <p style="color:#666; font-size:13px;">💰 SMS Balance: <strong>KES ${balance}</strong></p>
            </div>
            <button class="btn-add" id="composeMsgBtn">+ Compose Message</button>
        </div>
        <div class="filters" style="margin-bottom:15px;">
            <select id="msgFilterStatus" class="filter-input">
                <option value="all">All</option>
                <option value="unread">Unread</option>
                <option value="sent">Sent</option>
                <option value="unsent">Unsent</option>
                <option value="failed">Failed</option>
            </select>
            <input type="text" id="msgSearch" class="filter-input" placeholder="Search...">
        </div>
        <div id="messagesList" class="loading">Loading messages...</div>
    `;
    
    document.getElementById('composeMsgBtn').onclick = () => showComposeModal();
    document.getElementById('msgFilterStatus').onchange = () => filterMessages(messages || []);
    document.getElementById('msgSearch').oninput = () => filterMessages(messages || []);
    
    function filterMessages(allMessages) {
        const statusFilter = document.getElementById('msgFilterStatus').value;
        const search = document.getElementById('msgSearch').value.toLowerCase();
        let filtered = allMessages;
        if (statusFilter !== 'all') filtered = filtered.filter(m => m.status === statusFilter);
        if (search) filtered = filtered.filter(m => m.subject?.toLowerCase().includes(search) || m.message?.toLowerCase().includes(search));
        renderMessagesTable(filtered);
    }
    
    function renderMessagesTable(data) {
        const listDiv = document.getElementById('messagesList');
        if (!data || data.length === 0) { listDiv.innerHTML = '<div class="empty-state">No messages found</div>'; return; }
        let html = `<div class="table-wrapper"><table><thead><tr><th>Subject</th><th>Recipient</th><th>Date</th><th>Status</th><th>Actions</th></tr></thead><tbody>`;
        data.forEach(m => {
            const statusClass = m.status === 'sent' ? 'status-active' : (m.status === 'unsent' ? 'status-vacated' : (m.status === 'failed' ? 'status-vacated' : 'status-partial'));
            html += `<tr>
                <td>${escapeHtml(m.subject || 'No Subject')}</td>
                <td>${escapeHtml(m.recipient_type || '-')}</td>
                <td>${formatDate(m.created_at)}</td>
                <td><span class="${statusClass}">${m.status || 'Unsent'}</span></td>
                <td class="action-buttons">
                    <button class="btn-view" onclick="viewMessage(${m.id})">View</button>
                    ${m.status === 'unsent' || m.status === 'failed' ? `<button class="btn-edit" onclick="resendMessage(${m.id})">Resend</button>` : ''}
                    <button class="btn-danger" onclick="deleteMessage(${m.id})">Delete</button>
                </td>
            </tr>`;
        });
        html += `</tbody></table></div>`;
        listDiv.innerHTML = html;
    }
    renderMessagesTable(messages || []);
}


// ========== SHOW COMPOSE MODAL (IMPROVED) ==========
async function showComposeModal() {
    const properties = await apiCall('/properties');
    const tenants = await apiCall('/tenants');
    const templates = await apiCall('/settings/templates');
    
    const propertyOptions = properties ? properties.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('') : '';
    const tenantOptions = tenants ? tenants.map(t => `<option value="${t.id}">${escapeHtml(t.first_name)} ${escapeHtml(t.last_name)}</option>`).join('') : '';
    const templateOptions = templates ? templates.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('') : '';
    
    const modalHtml = `
        <div class="modal-content" style="max-width:600px; width:95%;">
            <h3>Compose Message</h3>
            
            <label>Recipient Type</label>
            <select id="recipientType" style="width:100%; padding:10px; border:1px solid #ddd; border-radius:6px; font-size:14px;">
                <option value="all">All Tenants</option>
                <option value="property">Tenants by Property</option>
                <option value="tenant">Specific Tenant</option>
                <option value="arrears">Tenants with Arrears</option>
            </select>
            
            <div id="recipientField" style="margin-top:12px; display:none;">
                <label id="recipientLabel">Select</label>
                <select id="recipientId" style="width:100%; padding:10px; border:1px solid #ddd; border-radius:6px; font-size:14px;">
                    ${tenantOptions}
                </select>
            </div>
            
            <label style="margin-top:14px;">Template</label>
            <select id="templateSelect" style="width:100%; padding:10px; border:1px solid #ddd; border-radius:6px; font-size:14px;">
                <option value="">-- Select Template --</option>
                ${templateOptions}
            </select>
            
            <label style="margin-top:14px;">Subject</label>
            <input type="text" id="msgSubject" placeholder="Enter subject" style="width:100%; padding:10px; border:1px solid #ddd; border-radius:6px; font-size:14px;">
            
            <label style="margin-top:14px;">Message</label>
            <textarea id="msgText" rows="8" placeholder="Type your message here..." style="width:100%; padding:10px; border:1px solid #ddd; border-radius:6px; font-size:14px; resize:vertical; min-height:150px;"></textarea>
            
            <p style="font-size:11px; color:#888; margin-top:6px;">* Editing the message will not affect the saved template.</p>
            
            <div class="modal-buttons" style="margin-top:20px;">
                <button class="btn-cancel" id="closeModalBtn">Cancel</button>
                <button class="btn-edit" id="draftBtn">Save Draft</button>
                <button class="btn-save" id="sendMsgBtn">Send Message</button>
            </div>
        </div>
    `;
    
    showModal(modalHtml, null);
    
    setTimeout(() => {
        const recipientType = document.getElementById('recipientType');
        const recipientField = document.getElementById('recipientField');
        const recipientId = document.getElementById('recipientId');
        const recipientLabel = document.getElementById('recipientLabel');
        const templateSelect = document.getElementById('templateSelect');
        const msgText = document.getElementById('msgText');
        const subjectInput = document.getElementById('msgSubject');
        
        // Update recipient field based on type
        const updateRecipientField = () => {
            const type = recipientType.value;
            
            if (type === 'all' || type === 'arrears') {
                recipientField.style.display = 'none';
            } else if (type === 'property') {
                recipientField.style.display = 'block';
                recipientLabel.textContent = 'Select Property';
                // Populate with properties
                recipientId.innerHTML = `<option value="">-- Select Property --</option>${propertyOptions}`;
            } else if (type === 'tenant') {
                recipientField.style.display = 'block';
                recipientLabel.textContent = 'Select Tenant';
                // Populate with tenants
                recipientId.innerHTML = `<option value="">-- Select Tenant --</option>${tenantOptions}`;
            }
        };
        
        recipientType.onchange = updateRecipientField;
        updateRecipientField();
        
        // Template selection
        templateSelect.onchange = async () => {
            if (templateSelect.value) {
                const template = await apiCall(`/settings/templates/${templateSelect.value}`);
                if (template) {
                    msgText.value = template.template_text;
                }
            }
        };
        
        // Send message
        document.getElementById('sendMsgBtn').onclick = async () => {
            const type = recipientType.value;
            let recipientIdValue = document.getElementById('recipientId').value;
            const subject = subjectInput.value;
            const message = msgText.value;
            const templateId = templateSelect.value;
            
            if (!message) {
                alert('Please enter a message');
                return;
            }
            
            // If property selected but no property chosen
            if (type === 'property' && !recipientIdValue) {
                alert('Please select a property');
                return;
            }
            
            // If tenant selected but no tenant chosen
            if (type === 'tenant' && !recipientIdValue) {
                alert('Please select a tenant');
                return;
            }
            
            const result = await apiCall('/messages/send', {
                method: 'POST',
                body: JSON.stringify({
                    recipient_type: type,
                    recipient_id: recipientIdValue || null,
                    subject: subject,
                    message: message,
                    template_id: templateId || null
                })
            });
            
            if (result?.error) {
                alert('Error: ' + result.error);
            } else {
                alert('Message sent successfully!');
                document.querySelector('.modal')?.remove();
                renderNotifications();
            }
        };
        
        // Save draft
        document.getElementById('draftBtn').onclick = async () => {
            const type = recipientType.value;
            let recipientIdValue = document.getElementById('recipientId').value;
            const subject = subjectInput.value;
            const message = msgText.value;
            
            if (!message) {
                alert('Please enter a message');
                return;
            }
            
            const result = await apiCall('/messages/draft', {
                method: 'POST',
                body: JSON.stringify({
                    recipient_type: type,
                    recipient_id: recipientIdValue || null,
                    subject: subject,
                    message: message
                })
            });
            
            if (result?.error) {
                alert('Error: ' + result.error);
            } else {
                alert('Draft saved successfully!');
                document.querySelector('.modal')?.remove();
                renderNotifications();
            }
        };
    }, 100);
}


// ========== VIEW MESSAGE ==========
window.viewMessage = async (id) => {
    const message = await apiCall(`/messages/${id}`);
    if (!message) return;
    
    const modalHtml = `
        <div class="modal-content" style="max-width:550px; width:95%;">
            <h3>Message Details</h3>
            <p><strong>Subject:</strong> ${escapeHtml(message.subject || 'No Subject')}</p>
            <p><strong>Recipient:</strong> ${escapeHtml(message.recipient_type)}</p>
            <p><strong>Date:</strong> ${formatDate(message.created_at)}</p>
            <p><strong>Status:</strong> ${message.status}</p>
            <div style="background:#f8f8f8; padding:15px; border-radius:6px; margin:10px 0; min-height:100px; white-space:pre-wrap;">
                ${escapeHtml(message.message)}
            </div>
            <div class="modal-buttons">
                <button class="btn-cancel" id="closeModalBtn">Close</button>
                ${message.status === 'unsent' || message.status === 'failed' ? `<button class="btn-edit" id="resendFromViewBtn">Resend</button>` : ''}
            </div>
        </div>
    `;
    showModal(modalHtml, null);
    
    setTimeout(() => {
        document.getElementById('resendFromViewBtn')?.addEventListener('click', () => {
            document.querySelector('.modal')?.remove();
            resendMessage(id);
        });
    }, 100);
};

window.resendMessage = async (id) => {
    const result = await apiCall(`/messages/resend/${id}`, { method: 'POST' });
    if (result?.error) alert('Error: ' + result.error);
    else { alert('Message resent!'); renderNotifications(); }
};

window.deleteMessage = async (id) => {
    if (confirm('Delete this message?')) {
        await apiCall(`/messages/${id}`, { method: 'DELETE' });
        renderNotifications();
    }
};

// ========== PROPERTIES ==========
async function renderProperties() {
    const content = document.getElementById('content');
    content.innerHTML = `<button class="btn-add" id="addPropertyBtn">+ Add Property</button><div id="propertyList" class="loading">Loading properties...</div><div id="pagination-container"></div>`;

    try {
        const properties = await apiCall('/properties');
        if (!properties) {
            document.getElementById('propertyList').innerHTML = '<div class="empty-state">Failed to load properties.</div>';
            return;
        }
        
        const allRooms = await apiCall('/rooms');
        
        const totalProperties = properties.length;
        const totalRooms = allRooms ? allRooms.length : 0;
        const occupiedRooms = allRooms ? allRooms.filter(r => r.status === 'occupied').length : 0;
        
        let estimatedMonthlyRent = 0;
        const propertyRentDetails = [];
        
        for (const property of properties) {
            const propertyRooms = allRooms ? allRooms.filter(r => r.property_id === property.id) : [];
            const occupiedPropertyRooms = propertyRooms.filter(r => r.status === 'occupied');
            const propertyEstimatedRent = occupiedPropertyRooms.reduce((sum, r) => sum + (parseFloat(r.rent) || 0), 0);
            estimatedMonthlyRent += propertyEstimatedRent;
            propertyRentDetails.push({
                id: property.id,
                name: property.name,
                occupiedRooms: occupiedPropertyRooms.length,
                estimatedRent: propertyEstimatedRent
            });
        }
        
        propertyRentDetails.sort((a, b) => b.estimatedRent - a.estimatedRent);

        let html = `
            <div class="cards">
                <div class="card"><h4>Total Property</h4><div class="value">${totalProperties}</div></div>
                <div class="card"><h4>Total Rooms</h4><div class="value">${totalRooms}</div></div>
                <div class="card"><h4>Occupied Rooms</h4><div class="value">${occupiedRooms}</div></div>
                <div class="card clickable" id="estimatedRentCard">
                    <h4>Estimated Monthly Rent</h4>
                    <div class="value">KES ${formatNumber(estimatedMonthlyRent)}</div>
                </div>
            </div>
            <div class="table-wrapper">
                <table class="properties-table">
                    <thead>
                        <tr>
                            <th>Property</th>
                            <th>Total Units</th>
                            <th>Occupied</th>
                            <th>Monthly Rent</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        const paginatedProperties = getPaginatedData(properties);
        for (const property of paginatedProperties) {
            const propertyRooms = allRooms ? allRooms.filter(r => r.property_id === property.id) : [];
            const totalUnits = propertyRooms.length;
            const occupiedUnits = propertyRooms.filter(r => r.status === 'occupied').length;
            const monthlyRent = propertyRooms.filter(r => r.status === 'occupied').reduce((sum, r) => sum + (parseFloat(r.rent) || 0), 0);
            
            html += `<tr>
                <td><strong>${escapeHtml(property.name)}</strong></td>
                <td>${totalUnits}</td>
                <td>${occupiedUnits} / ${totalUnits}</td>
                <td>KES ${formatNumber(monthlyRent)}</td>
                <td class="action-buttons">
                    <button class="btn-view" onclick="window.viewProperty(${property.id})">View</button>
                    <button class="btn-edit" onclick="window.editProperty(${property.id})">Edit</button>
                    <button class="btn-danger" onclick="window.deleteProperty(${property.id})">Delete</button>
                </td>
            </tr>`;
        }

        html += `</tbody></table></div>`;
        document.getElementById('propertyList').innerHTML = html;
        
        document.getElementById('addPropertyBtn').onclick = () => showAddPropertyModal();
        document.getElementById('estimatedRentCard').onclick = () => showEstimatedRentModal(propertyRentDetails);
        
        function refreshPropertiesPage() {
            renderProperties();
        }
        renderPagination('pagination-container', properties.length, refreshPropertiesPage);
        
    } catch (error) {
        document.getElementById('propertyList').innerHTML = '<div class="empty-state">Error loading properties.</div>';
    }
}

function showEstimatedRentModal(propertyRentDetails) {
    let rowsHtml = '';
    let totalExpectedRent = 0;
    propertyRentDetails.forEach(prop => {
        totalExpectedRent += prop.estimatedRent;
        rowsHtml += `<tr><td style="padding:8px">${escapeHtml(prop.name)}</td><td style="padding:8px">${prop.occupiedRooms}</td><td style="padding:8px">KES ${formatNumber(prop.estimatedRent)}</td></tr>`;
    });
    const modalHtml = `<div class="modal-content" style="max-width:600px;"><h3>Properties Expected Rent (Highest to Lowest)</h3><div class="table-wrapper"><table><thead><tr><th>Property Name</th><th>Occupied Rooms</th><th>Expected Rent</th></tr></thead><tbody>${rowsHtml}</tbody><tfoot><tr style="background:#f0f0f0;font-weight:bold;"><td><strong>TOTAL</strong></td><td><strong>${propertyRentDetails.reduce((sum, p) => sum + p.occupiedRooms, 0)}</strong></td><td><strong>KES ${formatNumber(totalExpectedRent)}</strong></td></tr></tfoot></table></div><div class="modal-buttons"><button class="btn-cancel" id="closeModalBtn">Close</button></div></div>`;
    showModal(modalHtml, null);
}

window.viewProperty = async (id) => {
    const property = await apiCall(`/properties/${id}`);
    if (!property) return;
    let roomsHtml = '';
    if (property.rooms && property.rooms.length > 0) {
        property.rooms.forEach(room => {
            roomsHtml += `<tr><td style="padding:8px">${escapeHtml(room.house_no)}</td><td style="padding:8px">${room.tenant_phone || '-'}</td><td style="padding:8px">${room.tenant_name || '-'}</td><td style="padding:8px">${room.status}</td></tr>`;
        });
    } else {
        roomsHtml = '<tr><td colspan="4" style="text-align:center">No rooms found</td></tr>';
    }
    const modalHtml = `<div class="modal-content" style="max-width:700px;"><h3>${escapeHtml(property.name)}</h3><p><strong>Location:</strong> ${escapeHtml(property.location)}</p><p><strong>Manager:</strong> ${escapeHtml(property.landlord_name)}</p><div class="table-wrapper"><table><thead><tr><th>Room No</th><th>Phone No</th><th>Tenant</th><th>Status</th></tr></thead><tbody>${roomsHtml}</tbody></table></div><div class="modal-buttons"><button class="btn-cancel" id="closeModalBtn">Close</button></div></div>`;
    showModal(modalHtml, null);
};

window.editProperty = async (id) => {
    const property = await apiCall(`/properties/${id}`);
    if (!property) return;
    
    const modalHtml = `
        <div class="modal-content" style="max-width:500px;">
            <h3>Edit Property</h3>
            <label>Property Name</label>
            <input type="text" id="editPropName" value="${escapeHtml(property.name)}" autocomplete="off">
            <label>Manager (Landlord)</label>
            <input type="text" id="editPropManager" value="${escapeHtml(property.landlord_name)}" autocomplete="off">
            <label>Location</label>
            <input type="text" id="editPropLocation" value="${escapeHtml(property.location)}" autocomplete="off">
            <label>Billing Day (1-28)</label>
            <input type="number" id="editPropBillingDay" value="${property.billing_day || 1}" min="1" max="28">
            <label>Penalty Amount (KES)</label>
            <input type="number" id="editPropPenalty" value="${property.penalty_amount || 0}" min="0">
            <label>Update Photo (leave blank to keep current)</label>
            <input type="file" id="editPropImage" accept="image/*">
            ${property.image_url ? `<div style="margin-top:6px;"><img src="${escapeHtml(property.image_url)}" style="max-width:100%;max-height:100px;border-radius:6px;" id="editPropPreview"></div>` : '<div id="editPropPreview"></div>'}
            <div id="editPropMsg" style="color:#e74c3c; font-size:13px; margin-top:5px;"></div>
            <div class="modal-buttons">
                <button class="btn-cancel" id="closeModalBtn">Cancel</button>
                <button class="btn-save" id="saveEditPropBtn">Update Property</button>
            </div>
        </div>
    `;
    
    showModal(modalHtml, null);
    
    setTimeout(() => {
        // Preview new image if selected
        document.getElementById('editPropImage')?.addEventListener('change', (e) => {
            if (e.target.files[0]) {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    document.getElementById('editPropPreview').innerHTML =
                        `<img src="${ev.target.result}" style="max-width:100%;max-height:100px;border-radius:6px;margin-top:6px;">`;
                };
                reader.readAsDataURL(e.target.files[0]);
            }
        });

        document.getElementById('saveEditPropBtn').onclick = async () => {
            const msg = document.getElementById('editPropMsg');
            msg.textContent = '';

            const name        = document.getElementById('editPropName').value.trim();
            const landlord    = document.getElementById('editPropManager').value.trim();
            const location    = document.getElementById('editPropLocation').value.trim();
            const billingDay  = parseInt(document.getElementById('editPropBillingDay').value) || 1;
            const penalty     = parseFloat(document.getElementById('editPropPenalty').value) || 0;

            if (!name || !landlord || !location) {
                msg.textContent = 'Name, Manager and Location are required.';
                return;
            }

            // Upload new image if selected, otherwise keep existing
            let imageUrl = property.image_url || null;
            const file = document.getElementById('editPropImage').files[0];
            if (file) {
                imageUrl = await uploadImage(file, 'property');
            }

            const result = await apiCall(`/properties/${id}`, {
                method: 'PUT',
                body: JSON.stringify({
                    name,
                    landlord_name: landlord,
                    location,
                    billing_day: billingDay,
                    penalty_amount: penalty,
                    image_url: imageUrl
                })
            });

            if (result?.error) {
                msg.textContent = result.error;
            } else {
                document.querySelector('.modal')?.remove();
                renderProperties();
            }
        };
    }, 100);
};

window.deleteProperty = async (id) => {
    if(confirm('Delete this property? This will also delete all rooms and tenants.')){
        const result = await apiCall(`/properties/${id}`, { method: 'DELETE' });
        if (result?.error) {
            alert('Error: ' + result.error);
        } else {
            alert('✅ Property deleted successfully!');
            renderProperties();
        }
    }
};
function showAddPropertyModal() {
    const modalHtml = `<div class="modal-content"><h3>Add new property</h3><label>Property name</label><input type="text" id="propName" autocomplete="off"><label>Manager</label><input type="text" id="propManager" autocomplete="off"><label>Location</label><input type="text" id="propLocation" autocomplete="off"><label>Penalty (KES)</label><input type="number" id="propPenalty" value="0"><label>Upload Photo</label><input type="file" id="propImage" accept="image/*"><div id="imagePreview"></div><div class="modal-buttons"><button class="btn-cancel" id="closeModalBtn">Cancel</button><button class="btn-save" id="saveModalBtn">Add Property</button></div></div>`;
    showModal(modalHtml, async () => {
        let imageUrl = null;
        const file = document.getElementById('propImage').files[0];
        if (file) imageUrl = await uploadImage(file, 'property');
        await apiCall('/properties', { method: 'POST', body: JSON.stringify({ name: document.getElementById('propName').value, landlord_name: document.getElementById('propManager').value, location: document.getElementById('propLocation').value, billing_day: 1, penalty_amount: parseFloat(document.getElementById('propPenalty').value) || 0, image_url: imageUrl }) });
        renderProperties();
    });
    document.getElementById('propImage')?.addEventListener('change', (e) => {
        if(e.target.files[0]){
            const reader = new FileReader();
            reader.onload = (ev) => document.getElementById('imagePreview').innerHTML = `<img src="${ev.target.result}" style="max-width:100%;max-height:150px;margin-top:10px;">`;
            reader.readAsDataURL(e.target.files[0]);
        }
    });
}

// ========== ROOMS ==========
async function renderRooms() {
    const content = document.getElementById('content');
    content.innerHTML = '<div class="loading">Loading rooms...</div>';
    
    const properties = await apiCall('/properties');
    if (!properties || properties.length === 0) {
        content.innerHTML = '<div class="empty-state">No properties found. Please add a property first.</div>';
        return;
    }
    
    content.innerHTML = `<div class="filters"><select id="propertyFilter"><option value="">All Properties</option>${properties.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}</select><input type="text" id="filterRoomName" placeholder="Room Name"><select id="filterType"><option value="">All Types</option><option>single</option><option>studio</option><option>shop</option><option>bedsitter</option><option>1 bedroom</option><option>2 bedroom</option><option>3 bedroom</option><option>4 bedroom</option><option>5 bedroom</option></select><select id="filterStatus"><option value="">All Status</option><option value="vacant">Vacant</option><option value="occupied">Occupied</option></select></div><button class="btn-add" id="addRoomBtn">+ Add Room</button><div id="roomsList" class="loading">Loading rooms...</div><div id="pagination-container"></div>`;
    
    let rooms = await apiCall('/rooms');
    if (!rooms) {
        document.getElementById('roomsList').innerHTML = '<div class="empty-state">Failed to load rooms.</div>';
        return;
    }
    
    let filteredRooms = [...rooms];
    
    document.getElementById('addRoomBtn').onclick = () => showAddRoomModal(properties);
    
    const filterFn = () => {
        const propertyFilter = document.getElementById('propertyFilter')?.value || '';
        const nameFilter = document.getElementById('filterRoomName')?.value.toLowerCase() || '';
        const typeFilter = document.getElementById('filterType')?.value.toLowerCase() || '';
        const statusFilter = document.getElementById('filterStatus')?.value.toLowerCase() || '';
        filteredRooms = rooms.filter(r => (!propertyFilter || r.property_id == propertyFilter) && (!nameFilter || r.house_no?.toLowerCase().includes(nameFilter)) && (!typeFilter || r.room_type?.toLowerCase() === typeFilter) && (!statusFilter || r.status === statusFilter));
        currentPage = 1;
        renderRoomsTable(filteredRooms, properties);
    };
    
    ['propertyFilter', 'filterRoomName', 'filterType', 'filterStatus'].forEach(id => { 
        document.getElementById(id)?.addEventListener('input', filterFn); 
        document.getElementById(id)?.addEventListener('change', filterFn); 
    });
    
    function renderRoomsTable(data, props) {
        currentData = data;
        const totalItems = data.length;
        const paginatedData = getPaginatedData(data);
        
        if(paginatedData.length === 0 && totalItems > 0) {
            currentPage = Math.ceil(totalItems / itemsPerPage);
            renderRoomsTable(data, props);
            return;
        }
        
        if(paginatedData.length === 0){ 
            document.getElementById('roomsList').innerHTML = '<div class="empty-state">No rooms found.</div>'; 
            renderPagination('pagination-container', totalItems, () => renderRoomsTable(currentData, props));
            return; 
        }
        
        let html = `<div class="table-wrapper"><table class="rooms-table"><thead><tr><th>Room Name</th><th>Type</th><th>Rent</th><th>Deposit</th><th>Status</th><th>Actions</th></tr></thead><tbody>`;
        paginatedData.forEach(r => { 
            const prop = props.find(p => p.id === r.property_id); 
            html += `<tr><td style="padding:6px 8px"><strong>${escapeHtml(r.house_no)}</strong><br><span style="font-size:10px;color:#888;">${escapeHtml(prop?.name)}</span></td><td style="padding:6px 8px">${escapeHtml(r.room_type)}</td><td style="padding:6px 8px">KES ${formatNumber(r.rent)}</td><td style="padding:6px 8px">KES ${formatNumber(r.deposit)}</td><td style="padding:6px 8px">${r.status}</td><td style="padding:6px 8px" class="action-buttons"><button class="btn-edit" onclick="window.editRoom(${r.id})">Edit</button> <button class="btn-danger" onclick="window.deleteRoom(${r.id})">Delete</button></td></tr>`;
        });
        html += `</tbody></table></div>`;
        document.getElementById('roomsList').innerHTML = html;
        renderPagination('pagination-container', totalItems, () => renderRoomsTable(currentData, props));
    }
    
    renderRoomsTable(filteredRooms, properties);
}

window.deleteRoom = async (id) => {
    if (!confirm('Delete this room? This will also remove any tenant assigned to it.')) {
        return;
    }
    
    try {
        const result = await apiCall(`/properties/room/${id}`, { method: 'DELETE' });
        
        if (result?.error) {
            alert('Error: ' + result.error);
        } else {
            alert('✅ Room deleted successfully!');
            renderRooms();
        }
    } catch (error) {
        alert('Error deleting room: ' + error.message);
    }
};

window.editRoom = async (id) => {
    
    const room = await apiCall(`/properties/room/${id}`);
    if(!room) return;
    
    const properties = await apiCall('/properties');
    const propertyOptions = properties.map(p => 
        `<option value="${p.id}" ${p.id === room.property_id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`
    ).join('');
    
    const modalHtml = `
        <div class="modal-content" style="max-width:500px;">
            <h3>Edit Room</h3>
            <label>Property</label>
            <select id="editRoomPropertyId">${propertyOptions}</select>
            <label>Unit Name (House No)</label>
            <input type="text" id="editRoomHouseNo" value="${escapeHtml(room.house_no)}" autocomplete="off">
            <label>Type</label>
            <select id="editRoomType">
                <option ${room.room_type === 'single' ? 'selected' : ''}>single</option>
                <option ${room.room_type === 'studio' ? 'selected' : ''}>studio</option>
                <option ${room.room_type === 'shop' ? 'selected' : ''}>shop</option>
                <option ${room.room_type === 'bedsitter' ? 'selected' : ''}>bedsitter</option>
                <option ${room.room_type === '1 bedroom' ? 'selected' : ''}>1 bedroom</option>
                <option ${room.room_type === '2 bedroom' ? 'selected' : ''}>2 bedroom</option>
                <option ${room.room_type === '3 bedroom' ? 'selected' : ''}>3 bedroom</option>
                <option ${room.room_type === '4 bedroom' ? 'selected' : ''}>4 bedroom</option>
                <option ${room.room_type === '5 bedroom' ? 'selected' : ''}>5 bedroom</option>
            </select>
            <label>Status</label>
            <select id="editRoomStatus">
                <option value="vacant" ${room.status === 'vacant' ? 'selected' : ''}>Vacant</option>
                <option value="occupied" ${room.status === 'occupied' ? 'selected' : ''}>Occupied</option>
                <option value="reserved" ${room.status === 'reserved' ? 'selected' : ''}>Reserved</option>
            </select>
            <label>Rent (Ksh)</label>
            <input type="number" id="editRoomRent" value="${room.rent}" step="0.01">
            <label>Deposit (Ksh)</label>
            <input type="number" id="editRoomDeposit" value="${room.deposit}" step="0.01">
            <label>Floor Number</label>
            <input type="number" id="editRoomFloor" value="${room.floor_number || 0}">
            <div id="editRoomMsg" style="color:#e74c3c; font-size:13px; margin-top:5px;"></div>
            <div class="modal-buttons">
                <button class="btn-cancel" id="closeModalBtn">Cancel</button>
                <button class="btn-save" id="saveEditRoomBtn">Update Room</button>
            </div>
        </div>
    `;
    
    showModal(modalHtml, null);
    
    setTimeout(() => {
        document.getElementById('saveEditRoomBtn').onclick = async () => {
            const msg = document.getElementById('editRoomMsg');
            const houseNo = document.getElementById('editRoomHouseNo').value.trim();
            
            if (!houseNo) {
                msg.textContent = 'Unit Name is required';
                return;
            }
            
            const result = await apiCall(`/properties/room/${id}`, {
                method: 'PUT',
                body: JSON.stringify({
                    property_id: parseInt(document.getElementById('editRoomPropertyId').value),
                    house_no: houseNo,
                    room_type: document.getElementById('editRoomType').value,
                    status: document.getElementById('editRoomStatus').value,
                    rent: parseFloat(document.getElementById('editRoomRent').value) || 0,
                    deposit: parseFloat(document.getElementById('editRoomDeposit').value) || 0,
                    floor_number: parseInt(document.getElementById('editRoomFloor').value) || 0
                })
            });
            
            if (result?.error) {
                msg.textContent = result.error;
            } else {
                alert('✅ Room updated successfully!');
                document.querySelector('.modal')?.remove();
                renderRooms();
            }
        };
    }, 100);
};

function showAddRoomModal(properties) {
    const modalHtml = `<div class="modal-content"><h3>Add Room</h3><label>Select Property *</label><select id="roomPropertyId">${properties.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}</select><label>Unit Name *</label><input type="text" id="unitName" autocomplete="off"><label>Type *</label><select id="roomType"><option>single</option><option>studio</option><option>shop</option><option>bedsitter</option><option>1 bedroom</option><option>2 bedroom</option><option>3 bedroom</option><option>4 bedroom</option><option>5 bedroom</option></select><label>Status *</label><select id="roomStatus"><option value="vacant">Vacant</option><option value="occupied">Occupied</option></select><label>Rent (Ksh) *</label><input type="number" id="roomRent" step="0.01"><label>Deposit (Ksh) *</label><input type="number" id="roomDeposit" step="0.01"><label>Floor NO</label><input type="number" id="floorNumber" value="0"><label>Images</label><input type="file" id="roomImage" accept="image/*"><div id="imagePreview"></div><div class="modal-buttons"><button class="btn-cancel" id="closeModalBtn">Cancel</button><button class="btn-save" id="saveModalBtn">Add Unit</button></div></div>`;
    showModal(modalHtml, async () => {
        let imageUrl = null;
        const file = document.getElementById('roomImage').files[0];
        if(file) imageUrl = await uploadImage(file, 'room');
        const unitName = document.getElementById('unitName').value.trim();
        if(!unitName){ alert('Unit Name is required'); return; }
        const propertyId = document.getElementById('roomPropertyId').value;
        const result = await apiCall(`/properties/${propertyId}/rooms`, { 
            method: 'POST', 
            body: JSON.stringify({ 
                house_no: unitName, 
                room_type: document.getElementById('roomType').value, 
                status: document.getElementById('roomStatus').value, 
                rent: parseFloat(document.getElementById('roomRent').value) || 0, 
                deposit: parseFloat(document.getElementById('roomDeposit').value) || 0, 
                floor_number: parseInt(document.getElementById('floorNumber').value) || 0, 
                image_url: imageUrl 
            }) 
        });
        if(result?.error) alert(result.error); 
        else renderRooms();
    });
    document.getElementById('roomImage')?.addEventListener('change', (e) => { if(e.target.files[0]){ const reader = new FileReader(); reader.onload = (ev) => document.getElementById('imagePreview').innerHTML = `<img src="${ev.target.result}" style="max-width:100%;max-height:150px;margin-top:10px;">`; reader.readAsDataURL(e.target.files[0]); } });
}

// ========== TENANTS ==========
async function renderTenants() {
    const content = document.getElementById('content');
    
    const allTenantsData = await apiCall('/tenants/all');
    const activeTenants = allTenantsData ? allTenantsData.filter(t => !t.is_deleted) : [];
    
    content.innerHTML = `
        <div style="display:flex; justify-content:flex-end; margin-bottom:15px;">
            <button class="btn-add" id="addTenantBtn">+ Add Tenant</button>
        </div>
        <div class="filter-row">
            <input type="text" id="searchTenant" class="filter-input" placeholder="Search name/room/phone" style="width:250px;">
            <select id="statusFilterTenant" class="filter-input" style="width:120px;">
                <option value="active" selected>Active</option>
                <option value="vacated">Vacated</option>
                <option value="all">All</option>
            </select>
            <select id="propertyFilterTenant" class="filter-input">
                <option value="">All Properties</option>
            </select>
            <div class="tenant-counter" id="tenantCounter">Total: ${activeTenants.length}</div>
        </div>
        <div id="tenantsList" class="loading">Loading tenants...</div>
        <div id="pagination-container"></div>
    `;
    
    const properties = await apiCall('/properties');
    if(properties){
        const filterSelect = document.getElementById('propertyFilterTenant');
        properties.forEach(p => { filterSelect.innerHTML += `<option value="${p.id}">${escapeHtml(p.name)}</option>`; });
    }
    
    let allTenants = await apiCall('/tenants/all');
    if(!allTenants) {
        document.getElementById('tenantsList').innerHTML = '<div class="empty-state">Failed to load tenants.</div>';
        return;
    }
    
    // Calculate balance for each tenant
    for (const tenant of allTenants) {
        const balanceResult = await apiCall(`/bills/tenant-balance/${tenant.id}`);
        tenant.balance = balanceResult?.balance || 0;
    }
    
    let filteredTenants = allTenants.filter(t => !t.is_deleted);
    
    document.getElementById('addTenantBtn').onclick = () => showAddTenantModal(properties);
    
    const filterTenants = () => {
        const search = document.getElementById('searchTenant')?.value.toLowerCase() || '';
        const statusFilter = document.getElementById('statusFilterTenant')?.value || 'active';
        const propertyFilter = document.getElementById('propertyFilterTenant')?.value || '';
        
        filteredTenants = allTenants.filter(t => {
            let match = true;
            if (statusFilter === 'active') {
                match = match && !t.is_deleted;
            } else if (statusFilter === 'vacated') {
                match = match && t.is_deleted === true;
            }
            if (propertyFilter) {
                match = match && t.property_id == propertyFilter;
            }
            if (search) {
                match = match && (
                    t.first_name?.toLowerCase().includes(search) || 
                    t.last_name?.toLowerCase().includes(search) || 
                    t.phone?.includes(search) || 
                    t.house_no?.toLowerCase().includes(search)
                );
            }
            return match;
        });
        
        currentPage = 1;
        document.getElementById('tenantCounter').innerHTML = `Total: ${filteredTenants.length}`;
        renderTenantsTable(filteredTenants);
    };
    
    ['searchTenant', 'statusFilterTenant', 'propertyFilterTenant'].forEach(id => { 
        document.getElementById(id)?.addEventListener('input', filterTenants); 
        document.getElementById(id)?.addEventListener('change', filterTenants); 
    });
    
    function renderTenantsTable(data) {
        currentData = data;
        const totalItems = data.length;
        const paginatedData = getPaginatedData(data);
        
        if(paginatedData.length === 0 && totalItems > 0) {
            currentPage = Math.ceil(totalItems / itemsPerPage);
            renderTenantsTable(data);
            return;
        }
        
        if(paginatedData.length === 0){ 
            document.getElementById('tenantsList').innerHTML = '<div class="empty-state">No tenants found.</div>'; 
            renderPagination('pagination-container', totalItems, () => renderTenantsTable(currentData));
            return; 
        }
        
        let html = `<div class="table-wrapper"><table class="tenants-table"><thead>
            <tr>
                <th>Name</th>
                <th>Phone no</th>
                <th>Property</th>
                <th>Unit</th>
                <th>Move-in</th>
                <th>Balance</th>
                <th>Status</th>
                <th>Action</th>
            </tr>
        </thead><tbody>`;
        
        paginatedData.forEach(t => {
            const statusText = t.is_deleted ? 'Vacated' : 'Active';
            const moveInDate = formatDate(t.move_in_date);
            
            const balanceValue = t.balance || 0;
            let balanceColor = '#333';
            let balanceDisplay = `KES ${formatNumber(Math.abs(balanceValue))}`;
            
            if (balanceValue < 0) {
                balanceColor = '#27ae60';
                balanceDisplay = `- KES ${formatNumber(Math.abs(balanceValue))}`;
            } else if (balanceValue > 0) {
                balanceColor = '#e74c3c';
            }
            
            html += `<tr>
                <td style="padding:6px 8px"><strong>${escapeHtml(t.first_name)} ${escapeHtml(t.last_name)}</strong></td>
                <td style="padding:6px 8px">${escapeHtml(t.phone)}</td>
                <td style="padding:6px 8px">${escapeHtml(t.property_name || '-')}</td>
                <td style="padding:6px 8px">${escapeHtml(t.house_no || '-')}</td>
                <td style="padding:6px 8px">${moveInDate}</td>
                <td style="padding:6px 8px; color:${balanceColor}; font-weight:${balanceValue !== 0 ? 'bold' : 'normal'};">${balanceDisplay}</td>
                <td style="padding:6px 8px"><span class="${statusText === 'Active' ? 'status-active' : 'status-vacated'}">${statusText}</span></td>
                <td style="padding:6px 8px" class="action-buttons">
                    <button class="btn-view" onclick="window.viewTenantDetail(${t.id})">View</button>
                    <button class="btn-edit" onclick="window.editTenant(${t.id})">Edit</button>
                    ${!t.is_deleted ? `<button class="btn-danger" onclick="window.deleteTenant(${t.id})">Delete</button>` : ''}
                </td>
            </tr>`;
        });
        
        html += `</tbody></table></div>`;
        document.getElementById('tenantsList').innerHTML = html;
        renderPagination('pagination-container', totalItems, () => renderTenantsTable(currentData));
    }
    
    renderTenantsTable(filteredTenants);
}

// ========== TENANT DETAILS ==========
window.viewTenantDetail = async (id) => {
    const tenant = await apiCall(`/tenants/${id}`);
    if(!tenant) return;
    const moveInDate = formatDate(tenant.move_in_date);
    
    // Get balance breakdown by item type
    const balanceBreakdown = await apiCall(`/bills/tenant-breakdown/${id}`);
    const totalBalance = balanceBreakdown ? balanceBreakdown.reduce((sum, item) => sum + item.amount, 0) : 0;
    
    // Build breakdown HTML with red text for unpaid
    let breakdownHtml = '<div style="margin-top:10px;"><table style="width:100%; font-size:12px;"><thead><tr><th>Item</th><th>Balance</th></tr></thead><tbody>';
    if (balanceBreakdown && balanceBreakdown.length > 0) {
        balanceBreakdown.forEach(item => {
            const balanceAmount = item.amount;
            const color = balanceAmount > 0 ? '#e74c3c' : '#333';
            breakdownHtml += `<tr>
                <td>${escapeHtml(item.item_name)}</td>
                <td style="color:${color}; font-weight:${balanceAmount > 0 ? 'bold' : 'normal'};">${balanceAmount > 0 ? `KES ${formatNumber(balanceAmount)}` : '-'}</td>
            </tr>`;
        });
    } else {
        breakdownHtml += '<tr><td colspan="2" style="text-align:center;">No outstanding balance</td></tr>';
    }
    breakdownHtml += `</tbody></table></div>`;
    
    // Get payments for this tenant
    const tenantPayments = await apiCall(`/payments/tenant/${id}`);
    
    // Build payments HTML
    let paymentsHtml = '';
    if (tenantPayments && tenantPayments.length > 0) {
        paymentsHtml = '<div class="table-wrapper"><table style="width:100%;"><thead><tr><th>Date</th><th>Amount</th><th>Type</th><th>Transaction ID</th></tr></thead><tbody>';
        tenantPayments.forEach(p => {
            paymentsHtml += `<tr>
                <td>${formatDate(p.payment_date)}</td>
                <td>KES ${formatNumber(p.amount)}</td>
                <td>${p.payment_type}</td>
                <td>${p.transaction_id || '-'}</td>
            </tr>`;
        });
        paymentsHtml += `</tbody></table></div>`;
    } else {
        paymentsHtml = '<div class="placeholder-message">No payments recorded</div>';
    }
    
    // Get invoices
    const invoices = await apiCall(`/bills/tenant-invoices/${id}`);
    
    let invoicesHtml = '';
    if (invoices && invoices.length > 0) {
        invoicesHtml = '<div class="table-wrapper"><table style="width:100%;"><thead><tr><th>Month</th><th>Items</th><th>Total Bill</th><th>Paid</th><th>Status</th></tr></thead><tbody>';
        invoices.forEach(inv => {
            const monthStr = new Date(inv.bill_month).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
            const itemsList = inv.items ? inv.items.map(i => `${i.item_name}: KES ${formatNumber(i.amount)}`).join(', ') : '-';
            const statusClass = inv.status === 'paid' ? 'status-active' : (inv.status === 'partially_paid' ? 'status-partial' : 'status-vacated');
            const statusText = inv.status === 'paid' ? 'Paid' : (inv.status === 'partially_paid' ? 'Partially Paid' : 'Not Paid');
            
            invoicesHtml += `<tr>
                <td>${monthStr}</td>
                <td>${itemsList}</td>
                <td>KES ${formatNumber(inv.total_bill)}</td>
                <td>KES ${formatNumber(inv.total_paid)}</td>
                <td><span class="${statusClass}">${statusText}</span></td>
            </tr>`;
        });
        invoicesHtml += `</tbody></table></div>`;
    } else {
        invoicesHtml = '<div class="placeholder-message">No invoices found</div>';
    }
    
    // Rent History (from invoices)
    let rentHistoryHtml = '';
    if (invoices && invoices.length > 0) {
        rentHistoryHtml = '<div class="table-wrapper"><table style="width:100%;"><thead><tr><th>Month</th><th>Paid Amount</th><th>Penalty</th><th>Balance</th></tr></thead><tbody>';
        invoices.forEach(inv => {
            const monthStr = new Date(inv.bill_month).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
            const balance = inv.total_bill - inv.total_paid;
            rentHistoryHtml += `<tr>
                <td>${monthStr}</td>
                <td>KES ${formatNumber(inv.total_paid)}</td>
                <td>KES ${formatNumber(inv.penalty_amount || 0)}</td>
                <td>KES ${formatNumber(balance > 0 ? balance : 0)}</td>
            </tr>`;
        });
        rentHistoryHtml += `</tbody></table></div>`;
    } else {
        rentHistoryHtml = '<div class="placeholder-message">No rent history</div>';
    }
    
    let profileImageHtml = tenant.profile_image ? `<img src="http://localhost:5014${tenant.profile_image}" class="tenant-avatar">` : `<div class="tenant-avatar" style="display:flex;align-items:center;justify-content:center;background:#ddd;">No Photo</div>`;
    
    const modalHtml = `<div class="modal-content" style="max-width:800px;">
        <div class="tenant-photo-section">
            <div class="photo-container">
                ${profileImageHtml}
                <div class="photo-buttons">
                    <input type="file" id="profilePhotoUpload" accept="image/*" style="display:none;">
                    <button class="btn-edit" id="uploadPhotoBtn">Upload</button>
                    <button class="btn-danger" id="removePhotoBtn">Remove</button>
                </div>
            </div>
            <div class="tenant-info">
                <p><strong>Name:</strong> ${escapeHtml(tenant.first_name)} ${escapeHtml(tenant.last_name)}</p>
                <p><strong>Phone No:</strong> ${escapeHtml(tenant.phone)}</p>
                <p><strong>Unit:</strong> ${escapeHtml(tenant.house_no || '-')}</p>
                <p><strong>Status:</strong> Active</p>
                <p><strong>Member Since:</strong> ${moveInDate}</p>
                <p><strong>Balance:</strong> <span id="balanceAmount" style="cursor:pointer; color:#4a90d9; text-decoration:underline;">KES ${formatNumber(totalBalance)}</span></p>
                <div id="balanceBreakdown" style="display:none; margin-top:10px; padding:10px; background:#f8f9fa; border-radius:6px;">
                    <strong>Balance Breakdown:</strong>
                    ${breakdownHtml}
                </div>
            </div>
        </div>
        <div class="tenant-tabs">
            <button class="tab-btn active" data-tab="overview">Overview</button>
            <button class="tab-btn" data-tab="payments">Payments</button>
            <button class="tab-btn" data-tab="invoices">Invoices</button>
            <button class="tab-btn" data-tab="renthistory">Rent History</button>
        </div>
        
        <div id="tab-overview" class="tab-content active">
            <div class="overview-grid">
                <div class="overview-item"><label>Email</label><span>${tenant.email || '-'}</span></div>
                <div class="overview-item"><label>Phone No</label><span>${tenant.phone}</span></div>
                <div class="overview-item"><label>National Id</label><span>${tenant.national_id}</span></div>
                <div class="overview-item"><label>Move in Date</label><span>${moveInDate}</span></div>
            </div>
            <div class="id-section">
                <h4>Identification</h4>
                <div class="id-images">
                    <div class="id-card"><p>Front Id</p>${tenant.front_id_image ? `<img src="http://localhost:5014${tenant.front_id_image}">` : '<p>Not uploaded</p>'}</div>
                    <div class="id-card"><p>Back Id</p>${tenant.back_id_image ? `<img src="http://localhost:5014${tenant.back_id_image}">` : '<p>Not uploaded</p>'}</div>
                </div>
            </div>
        </div>
        
        <div id="tab-payments" class="tab-content">
            ${paymentsHtml}
        </div>
        
        <div id="tab-invoices" class="tab-content">
            ${invoicesHtml}
        </div>
        
        <div id="tab-renthistory" class="tab-content">
            ${rentHistoryHtml}
        </div>
        
        <div class="modal-buttons">
            <button class="btn-edit" id="sendMsgToTenantBtn">Send Message</button>
            <button class="btn-cancel" id="closeModalBtn">Close</button>
        </div>
    </div>`;
    
    showModal(modalHtml, null);
    
    // Make balance clickable to show/hide breakdown
    const balanceElement = document.getElementById('balanceAmount');
    const breakdownDiv = document.getElementById('balanceBreakdown');
    if (balanceElement && breakdownDiv) {
        balanceElement.onclick = () => {
            if (breakdownDiv.style.display === 'none') {
                breakdownDiv.style.display = 'block';
            } else {
                breakdownDiv.style.display = 'none';
            }
        };
    }
    
    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(`tab-${btn.getAttribute('data-tab')}`).classList.add('active');
        };
    });
    
    // Send Message button
    document.getElementById('sendMsgToTenantBtn').onclick = () => {
        showComposeModalForTenant(id, tenant);
    };
    
    // Photo upload
    const fileInput = document.getElementById('profilePhotoUpload');
    const uploadBtn = document.getElementById('uploadPhotoBtn');
    const removeBtn = document.getElementById('removePhotoBtn');
    
    if (uploadBtn) {
        uploadBtn.onclick = () => fileInput.click();
    }
    
    if (fileInput) {
        fileInput.onchange = async (e) => {
            if(e.target.files[0]){
                const imageUrl = await uploadImage(e.target.files[0], 'property');
                await apiCall(`/tenants/${id}`, { method: 'PUT', body: JSON.stringify({ ...tenant, profile_image: imageUrl }) });
                document.querySelector('.modal')?.remove();
                viewTenantDetail(id);
            }
        };
    }
    
    if (removeBtn) {
        removeBtn.onclick = async () => {
            await apiCall(`/tenants/${id}`, { method: 'PUT', body: JSON.stringify({ ...tenant, profile_image: null }) });
            document.querySelector('.modal')?.remove();
            viewTenantDetail(id);
        };
    }
};

function showComposeModalForTenant(tenantId, tenant) {
    const modalHtml = `
        <div class="modal-content" style="max-width:550px;">
            <h3>Send Message to ${escapeHtml(tenant.first_name)} ${escapeHtml(tenant.last_name)}</h3>
            <label>Template</label><select id="templateSelect"><option value="">-- Select Template --</option></select>
            <label>Subject</label><input type="text" id="msgSubject" placeholder="Enter subject">
            <label>Message</label><textarea id="msgText" rows="5" placeholder="Type your message..."></textarea>
            <div class="modal-buttons">
                <button class="btn-cancel" id="closeModalBtn">Cancel</button>
                <button class="btn-save" id="sendMsgBtn">Send Message</button>
            </div>
        </div>
    `;
    showModal(modalHtml, async () => {
        const subject = document.getElementById('msgSubject').value;
        const message = document.getElementById('msgText').value;
        if (!message) { alert('Please enter a message'); return; }
        const result = await apiCall('/messages/send', {
            method: 'POST',
            body: JSON.stringify({ recipient_type: 'tenant', recipient_id: tenantId, subject, message })
        });
        if (result?.error) alert('Error: ' + result.error);
        else { alert('Message sent!'); document.querySelector('.modal')?.remove(); }
    });
    setTimeout(async () => {
        const templates = await apiCall('/settings/templates');
        const select = document.getElementById('templateSelect');
        if (templates) {
            templates.forEach(t => { select.innerHTML += `<option value="${t.id}">${escapeHtml(t.name)}</option>`; });
        }
        select.onchange = async () => {
            if (select.value) {
                const template = await apiCall(`/settings/templates/${select.value}`);
                if (template) document.getElementById('msgText').value = template.template_text;
            }
        };
    }, 100);
}

window.editTenant = async (id) => {
    const tenant = await apiCall(`/tenants/${id}`);
    if(!tenant) return;
    
    const properties = await apiCall('/properties');
    const rooms = await apiCall('/rooms');
    const vacantRooms = rooms?.filter(r => r.status === 'vacant' || r.id === tenant.room_id) || [];
    
    const propertyOptions = properties.map(p => 
        `<option value="${p.id}" ${p.id === tenant.property_id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`
    ).join('');
    
    const modalHtml = `
        <div class="modal-content" style="max-width:500px;">
            <h3>Edit Tenant</h3>
            <label>First Name</label>
            <input type="text" id="editFirstName" value="${escapeHtml(tenant.first_name)}" autocomplete="off">
            <label>Last Name</label>
            <input type="text" id="editLastName" value="${escapeHtml(tenant.last_name)}" autocomplete="off">
            <label>Phone Number</label>
            <input type="tel" id="editPhone" value="${escapeHtml(tenant.phone)}" autocomplete="off">
            <label>Email</label>
            <input type="email" id="editEmail" value="${escapeHtml(tenant.email || '')}" autocomplete="off">
            <label>National ID</label>
            <input type="text" id="editNationalId" value="${escapeHtml(tenant.national_id || '')}" autocomplete="off">
            <label>Account Number</label>
            <input type="text" id="editAccountNumber" value="${escapeHtml(tenant.account_number)}" autocomplete="off" readonly style="background:#f0f0f0;">
            <label>Property</label>
            <select id="editPropertyId">${propertyOptions}</select>
            <label>Room</label>
            <select id="editRoomId"></select>
            <label>Move In Date</label>
            <input type="date" id="editMoveInDate" value="${tenant.move_in_date}">
            <div id="editTenantMsg" style="color:#e74c3c; font-size:13px; margin-top:5px;"></div>
            <div class="modal-buttons">
                <button class="btn-cancel" id="closeModalBtn">Cancel</button>
                <button class="btn-save" id="saveEditTenantBtn">Update Tenant</button>
            </div>
        </div>
    `;
    
    showModal(modalHtml, null);
    
    setTimeout(() => {
        // Populate rooms for the selected property
        const propertySelect = document.getElementById('editPropertyId');
        const roomSelect = document.getElementById('editRoomId');
        
        const updateRooms = () => {
            const propId = parseInt(propertySelect.value);
            const available = vacantRooms.filter(r => r.property_id === propId);
            roomSelect.innerHTML = available.map(r => 
                `<option value="${r.id}" ${r.id === tenant.room_id ? 'selected' : ''}>${escapeHtml(r.house_no)} - ${escapeHtml(r.room_type)} (KES ${formatNumber(r.rent)})</option>`
            ).join('');
            if(available.length === 0) roomSelect.innerHTML = '<option value="">No rooms available</option>';
        };
        
        propertySelect.onchange = updateRooms;
        updateRooms();
        
        // Save button
        document.getElementById('saveEditTenantBtn').onclick = async () => {
            const roomId = document.getElementById('editRoomId').value;
            const msg = document.getElementById('editTenantMsg');
            
            if (!roomId) {
                msg.textContent = 'Please select a room';
                return;
            }
            
            const result = await apiCall(`/tenants/${id}`, {
                method: 'PUT',
                body: JSON.stringify({
                    first_name: document.getElementById('editFirstName').value,
                    last_name: document.getElementById('editLastName').value,
                    phone: document.getElementById('editPhone').value,
                    email: document.getElementById('editEmail').value,
                    national_id: document.getElementById('editNationalId').value,
                    account_number: document.getElementById('editAccountNumber').value,
                    property_id: parseInt(document.getElementById('editPropertyId').value),
                    room_id: parseInt(roomId),
                    move_in_date: document.getElementById('editMoveInDate').value
                })
            });
            
            if (result?.error) {
                msg.textContent = result.error;
            } else {
                alert('✅ Tenant updated successfully!');
                document.querySelector('.modal')?.remove();
                renderTenants();
                renderProperties();
                renderRooms();
            }
        };
    }, 100);
};

window.deleteTenant = async (id) => {
    if(confirm('Vacate this tenant? The room will become available.')){
        await apiCall(`/tenants/${id}`, { method: 'DELETE' });
        renderTenants();
    }
};

async function showAddTenantModal(properties) {
    if(!properties || properties.length === 0){ alert('Please add a property first.'); return; }
    let step = 1;
    let tenantData = {};
    let selectedBills = [];
    
    const renderStep1 = () => {
        return `<div class="modal-content"><h3>Add Tenant - Step 1</h3><label>First Name *</label><input type="text" id="firstName" autocomplete="off"><label>Last Name *</label><input type="text" id="lastName" autocomplete="off"><label>Phone Number *</label><input type="tel" id="phone" autocomplete="off"><label>Email</label><input type="email" id="email" autocomplete="off"><label>National ID *</label><input type="text" id="nationalId" autocomplete="off" inputmode="numeric" pattern="[0-9]*"><label>Front ID (optional)</label><input type="file" id="frontId" accept="image/*"><div id="frontPreview"></div><label>Back ID (optional)</label><input type="file" id="backId" accept="image/*"><div id="backPreview"></div><div class="modal-buttons"><button class="btn-cancel" id="closeModalBtn">Cancel</button><button class="btn-save" id="nextBtn">Next</button></div></div>`;
    };
    
    const renderStep2 = () => {
        const propertyOptions = properties.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
        return `<div class="modal-content"><h3>Add Tenant - Step 2</h3><label>Property *</label><select id="propertyId">${propertyOptions}</select><label>Room (Unit) *</label><select id="roomId"><option>Select property first</option></select><label>Move in Date *</label><input type="date" id="moveInDate" value="${new Date().toISOString().split('T')[0]}"><div class="modal-buttons"><button class="btn-cancel" id="closeModalBtn">Cancel</button><button class="btn-edit" id="backBtn">Back</button><button class="btn-save" id="nextBtn">Next</button></div></div>`;
    };
    
    const renderStep3 = () => {
        let billsHtml = '<div class="bills-list" id="billsList"></div><div class="add-bill-row"><input type="text" id="newBillName" placeholder="Bill name (e.g., Water)"><button type="button" class="btn-add" id="addBillBtn">Add</button></div>';
        return `<div class="modal-content"><h3>Add Tenant - Step 3</h3><label>Additional Bills (Optional)</label>${billsHtml}<div class="modal-buttons"><button class="btn-cancel" id="closeModalBtn">Cancel</button><button class="btn-edit" id="backBtn">Back</button><button class="btn-save" id="saveTenantBtn">Save Tenant</button></div></div>`;
    };
    
    const updateModal = () => {
        let html = '';
        if(step === 1) html = renderStep1();
        else if(step === 2) html = renderStep2();
        else html = renderStep3();
        document.querySelector('.modal-content').outerHTML = html;
        attachEvents();
    };
    
    const attachEvents = () => {
        document.getElementById('closeModalBtn')?.addEventListener('click', () => document.querySelector('.modal')?.remove());
        if(step === 1){
            document.getElementById('frontId')?.addEventListener('change', (e) => { if(e.target.files[0]){ const reader = new FileReader(); reader.onload = (ev) => document.getElementById('frontPreview').innerHTML = `<img src="${ev.target.result}" style="max-width:100px;margin-top:5px;">`; reader.readAsDataURL(e.target.files[0]); } });
            document.getElementById('backId')?.addEventListener('change', (e) => { if(e.target.files[0]){ const reader = new FileReader(); reader.onload = (ev) => document.getElementById('backPreview').innerHTML = `<img src="${ev.target.result}" style="max-width:100px;margin-top:5px;">`; reader.readAsDataURL(e.target.files[0]); } });
            document.getElementById('nextBtn').onclick = async () => {
                tenantData.first_name = document.getElementById('firstName').value;
                tenantData.last_name = document.getElementById('lastName').value;
                tenantData.phone = document.getElementById('phone').value;
                tenantData.email = document.getElementById('email').value;
                tenantData.national_id = document.getElementById('nationalId').value;
                if(!tenantData.first_name || !tenantData.last_name || !tenantData.phone  ){ alert('Please fill all required fields'); return; }
                const frontFile = document.getElementById('frontId').files[0];
                const backFile = document.getElementById('backId').files[0];
                if(frontFile) tenantData.front_id_image = await uploadImage(frontFile, 'property');
                if(backFile) tenantData.back_id_image = await uploadImage(backFile, 'property');
                step = 2;
                updateModal();
            };
        }
        else if(step === 2){
            const propertySelect = document.getElementById('propertyId');
            const roomSelect = document.getElementById('roomId');
            const loadRooms = async () => {
                const propId = propertySelect.value;
                const rooms = await apiCall(`/tenants/available-rooms/${propId}`);
                if(rooms && rooms.length > 0) roomSelect.innerHTML = rooms.map(r => `<option value="${r.id}">${escapeHtml(r.house_no)} - ${escapeHtml(r.room_type)} (KES ${formatNumber(r.rent)})</option>`).join('');
                else roomSelect.innerHTML = '<option value="">No vacant rooms available</option>';
            };
            propertySelect.onchange = loadRooms;
            loadRooms();
            document.getElementById('backBtn').onclick = () => { step = 1; updateModal(); };
            document.getElementById('nextBtn').onclick = () => {
                tenantData.property_id = document.getElementById('propertyId').value;
                tenantData.room_id = document.getElementById('roomId').value;
                tenantData.move_in_date = document.getElementById('moveInDate').value;
                if(!tenantData.property_id || !tenantData.room_id || !tenantData.move_in_date){ alert('Please select property, room, and move in date'); return; }
                step = 3;
                updateModal();
            };
        }
        else if(step === 3){
            const updateBillsList = () => {
                const container = document.getElementById('billsList');
                container.innerHTML = selectedBills.map((b, i) => `<span class="bill-item">${escapeHtml(b)} <button style="background:none;border:none;cursor:pointer;margin-left:5px;" onclick="this.parentElement.remove(); selectedBills.splice(${i},1);">✖</button></span>`).join('');
            };
            updateBillsList();
            document.getElementById('addBillBtn').onclick = () => {
                const newBill = document.getElementById('newBillName').value.trim();
                if(newBill){ selectedBills.push(newBill); updateBillsList(); document.getElementById('newBillName').value = ''; }
            };
            document.getElementById('backBtn').onclick = () => { step = 2; updateModal(); };
            document.getElementById('saveTenantBtn').onclick = async () => {
                tenantData.account_number = `TENANT${Date.now()}`;
                const result = await apiCall('/tenants', { method: 'POST', body: JSON.stringify(tenantData) });
                // In showAddTenantModal or add tenant logic
if (result?.error) {
    if (result.field === 'phone') {
        alert(`❌ ${result.error}\n\nThis phone number is already used by: ${result.existing_tenant}\nPlease use a different phone number.`);
    } else if (result.field === 'national_id') {
        alert(`❌ ${result.error}\n\nThis National ID is already used by: ${result.existing_tenant}\nPlease use a different National ID.`);
    } else {
        alert('Error: ' + result.error);
    }
    return;
}
                if(result?.error){ alert(result.error); return; }
                if(selectedBills.length > 0 && result.id){
                    await apiCall(`/tenants/${result.id}/additional-bills`, { method: 'POST', body: JSON.stringify({ bills: selectedBills }) });
                }
                document.querySelector('.modal')?.remove();
                renderTenants();
            };
        }
    };
    
    const initialModal = document.createElement('div');
    initialModal.className = 'modal';
    initialModal.style.display = 'flex';
    initialModal.innerHTML = renderStep1();
    document.body.appendChild(initialModal);
    attachEvents();
    initialModal.addEventListener('click', (e) => { if(e.target === initialModal) initialModal.remove(); });
}

// ========== BILLING SECTION ==========
async function renderBilling() {
    const content = document.getElementById('content');
    
    // Get filter data
    const filterData = await apiCall('/bills/filters/data');
    const properties = filterData?.properties || [];
    const tenants = filterData?.tenants || [];
    const rooms = filterData?.rooms || [];
    
    content.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; flex-wrap:wrap; gap:10px;">
            <div style="display:flex; gap:10px;">
                <button class="btn-add" id="createBillBtn">+ Create Bill</button>
                <button class="btn-add" id="bulkCreateBtn" style="background:#3498db;">📦 Bulk Create (Property)</button>
                <button class="btn-add" id="awardPenaltyBtn" style="background:#e74c3c;">⚠️ Award Penalties</button>
            </div>
            <div>
                <button class="btn-add" id="autoGenerateBtn" style="background:#5cb85c;">🔄 Auto Generate Rent</button>
            </div>
        </div>
        <div class="filters">
            <select id="filterProperty" class="filter-input">
                <option value="">All Properties</option>
                ${properties.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}
            </select>
            <select id="filterRoom" class="filter-input">
                <option value="">All Units</option>
                ${rooms.map(r => `<option value="${r.id}" data-property="${r.property_id}">${escapeHtml(r.house_no)}</option>`).join('')}
            </select>
            <select id="filterTenant" class="filter-input">
                <option value="">All Tenants</option>
                ${tenants.map(t => `<option value="${t.id}">${escapeHtml(t.first_name)} ${escapeHtml(t.last_name)}</option>`).join('')}
            </select>
            <select id="filterStatus" class="filter-input">
                <option value="">All Status</option>
                <option value="paid">Paid</option>
                <option value="partially_paid">Partially Paid</option>
                <option value="not_paid">Not Paid</option>
            </select>
            <input type="month" id="filterMonth" class="filter-input" placeholder="Bill Month">
        </div>
        <div id="billsList" class="loading">Loading bills...</div>
        <div id="pagination-container"></div>
    `;
    
    // Attach button event listeners
    const createBtn = document.getElementById('createBillBtn');
    const autoGenBtn = document.getElementById('autoGenerateBtn');
    const bulkCreateBtn = document.getElementById('bulkCreateBtn');
    const awardPenaltyBtn = document.getElementById('awardPenaltyBtn');
    
    if (createBtn) createBtn.onclick = () => showCreateBillModal();
    if (autoGenBtn) autoGenBtn.onclick = () => showAutoGenerateModal();
    if (bulkCreateBtn) bulkCreateBtn.onclick = () => showBulkCreateModal();
    if (awardPenaltyBtn) awardPenaltyBtn.onclick = () => showAwardPenaltyModal();
    
    // Room filter depends on property
    const propertySelect = document.getElementById('filterProperty');
    const roomSelect = document.getElementById('filterRoom');
    const originalRoomOptions = roomSelect ? [...roomSelect.options] : [];
    
    if (propertySelect) {
        propertySelect.onchange = () => {
            const propId = propertySelect.value;
            if (roomSelect) {
                roomSelect.innerHTML = '<option value="">All Units</option>';
                originalRoomOptions.forEach(opt => {
                    if (opt.value === "" || opt.getAttribute('data-property') == propId || propId === "") {
                        roomSelect.appendChild(opt.cloneNode(true));
                    }
                });
            }
            filterBills();
        };
    }
    
    let allBills = [];
    
    async function loadBills() {
        allBills = await apiCall('/bills');
        if (!allBills) return;
        filterBills();
    }
    
    function filterBills() {
        const propertyId = document.getElementById('filterProperty')?.value || '';
        const roomId = document.getElementById('filterRoom')?.value || '';
        const tenantId = document.getElementById('filterTenant')?.value || '';
        const status = document.getElementById('filterStatus')?.value || '';
        const month = document.getElementById('filterMonth')?.value || '';
        
        let filtered = [...allBills];
        
        if (propertyId) filtered = filtered.filter(b => b.property_id == propertyId);
        if (roomId) filtered = filtered.filter(b => b.room_id == roomId);
        if (tenantId) filtered = filtered.filter(b => b.tenant_id == tenantId);
        if (status) filtered = filtered.filter(b => b.status === status);
        if (month) {
            const [year, monthNum] = month.split('-');
            filtered = filtered.filter(b => {
                const billDate = new Date(b.bill_month);
                return billDate.getFullYear() == year && (billDate.getMonth() + 1) == parseInt(monthNum);
            });
        }
        
        currentPage = 1;
        renderBillsTable(filtered);
    }
    
    function renderBillsTable(data) {
        currentData = data;
        const totalItems = data.length;
        const paginatedData = getPaginatedData(data);
        
        if(paginatedData.length === 0 && totalItems > 0) {
            currentPage = Math.ceil(totalItems / itemsPerPage);
            renderBillsTable(data);
            return;
        }
        
        if(paginatedData.length === 0){ 
            document.getElementById('billsList').innerHTML = '<div class="empty-state">No bills found.</div>'; 
            renderPagination('pagination-container', totalItems, () => renderBillsTable(currentData));
            return; 
        }
        
        let html = `<div class="table-wrapper"><table class="bills-table"><thead>
            <tr><th>Tenant</th><th>Property</th><th>Month</th><th>Total Bill</th><th>Status</th><th>Actions</th></tr>
        </thead><tbody>`;
        
        paginatedData.forEach(b => {
            const monthStr = new Date(b.bill_month).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
            const statusClass = b.status === 'paid' ? 'status-active' : (b.status === 'partially_paid' ? 'status-partial' : 'status-vacated');
            const statusText = b.status === 'paid' ? 'Paid' : (b.status === 'partially_paid' ? 'Partially Paid' : 'Not Paid');
            
            html += `<tr>
                <td><strong>${escapeHtml(b.first_name)} ${escapeHtml(b.last_name)}</strong></td>
                <td>${escapeHtml(b.property_name)}</td>
                <td>${monthStr}</td>
                <td>KES ${formatNumber(b.total_bill)}</td>
                <td><span class="${statusClass}">${statusText}</span></td>
                <td class="action-buttons">
                    <button class="btn-view" onclick="window.viewBill(${b.id})">View</button>
                    <button class="btn-edit" onclick="window.editBill(${b.id})">Edit</button>
                    <button class="btn-danger" onclick="window.deleteBill(${b.id})">Delete</button>
                </td>
            </tr>`;
        });
        
        html += `</tbody></table></div>`;
        document.getElementById('billsList').innerHTML = html;
        renderPagination('pagination-container', totalItems, () => renderBillsTable(currentData));
    }
    
    // Attach filter event listeners
    const filterIds = ['filterProperty', 'filterRoom', 'filterTenant', 'filterStatus', 'filterMonth'];
    filterIds.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.addEventListener('change', filterBills);
        }
    });
    
    await loadBills();
}

// ========== BILLING ACTIONS ==========

window.viewBill = async (id) => {
    const bill = await apiCall(`/bills/${id}`);
    if (!bill) return;
    
    const monthStr = new Date(bill.bill_month).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    const statusText = bill.status === 'paid' ? 'Paid' : (bill.status === 'partially_paid' ? 'Partially Paid' : 'Not Paid');
    
    let itemsHtml = '';
    if (bill.items) {
        bill.items.forEach(item => {
            itemsHtml += `<tr><td>${escapeHtml(item.item_name)}</td><td>KES ${formatNumber(item.amount)}</td></tr>`;
        });
    }
    
    const previousBalance = parseFloat(bill.previous_balance) || 0;
    const balanceDisplay = previousBalance > 0 ? `- KES ${formatNumber(previousBalance)}` : (previousBalance < 0 ? `+ KES ${formatNumber(Math.abs(previousBalance))}` : 'KES 0');
    
    const modalHtml = `<div class="modal-content" style="max-width:600px;">
        <h3>Bill Details</h3>
        <p><strong>Tenant:</strong> ${escapeHtml(bill.first_name)} ${escapeHtml(bill.last_name)}</p>
        <p><strong>Unit:</strong> ${escapeHtml(bill.house_no)}</p>
        <p><strong>Status:</strong> ${statusText}</p>
        <p><strong>Bill Month:</strong> ${monthStr}</p>
        <div class="table-wrapper"><table class="items-table"><thead><tr><th>Item</th><th>Amount</th></tr></thead><tbody>${itemsHtml}</tbody></table></div>
        <p><strong>Total Bill:</strong> KES ${formatNumber(bill.total_bill)}</p>
        <p><strong>Previous Balance:</strong> ${balanceDisplay}</p>
        <div class="modal-buttons">
            <button class="btn-edit" id="sendMessageBtn">Send Message</button>
            <button class="btn-cancel" id="closeModalBtn">Close</button>
        </div>
    </div>`;
    
    showModal(modalHtml, null);
    document.getElementById('sendMessageBtn')?.addEventListener('click', () => {
        const msg = `Hello ${bill.first_name} ${bill.last_name}, your ${monthStr} bill for ${bill.items ? bill.items.map(i => i.item_name).join(', ') : 'rent'} is KES ${formatNumber(bill.total_bill)}.`;
        alert('Send SMS: ' + msg);
    });
};

window.editBill = async (id) => {
    const bill = await apiCall(`/bills/${id}`);
    if (!bill) return;
    
    let itemsHtml = '';
    if (bill.items && bill.items.length > 0) {
        bill.items.forEach((item) => {
            itemsHtml += `<div class="bill-item-row" style="display:flex; gap:10px; margin-top:5px;">
                <input type="text" class="item-name" value="${escapeHtml(item.item_name)}" placeholder="Item name" style="flex:2;">
                <input type="number" class="item-amount" value="${item.amount}" step="0.01" placeholder="Amount" style="flex:1;">
                <button type="button" class="btn-danger remove-item-btn" style="padding:5px 10px;">✖</button>
            </div>`;
        });
    } else {
        itemsHtml = `<div class="bill-item-row" style="display:flex; gap:10px; margin-top:5px;">
            <input type="text" class="item-name" placeholder="Item name" style="flex:2;">
            <input type="number" class="item-amount" placeholder="Amount" step="0.01" style="flex:1;">
            <button type="button" class="btn-danger remove-item-btn" style="padding:5px 10px;">✖</button>
        </div>`;
    }
    
    const modalHtml = `<div class="modal-content" style="max-width:600px;">
        <h3>Edit Bill</h3>
        <label>Previous Balance</label><input type="number" id="editPrevBalance" value="${bill.previous_balance || 0}" step="0.01">
        <label>Bill Items</label>
        <div id="billItemsContainer">${itemsHtml}</div>
        <button type="button" class="btn-add" id="addBillItemBtn" style="margin-top:10px;">+ Add Item</button>
        <div class="modal-buttons">
            <button class="btn-cancel" id="closeModalBtn">Cancel</button>
            <button class="btn-save" id="saveBillBtn">Save Changes</button>
        </div>
    </div>`;
    
    showModal(modalHtml, async () => {
        const items = [];
        document.querySelectorAll('.bill-item-row').forEach(row => {
            const itemName = row.querySelector('.item-name')?.value;
            const amount = parseFloat(row.querySelector('.item-amount')?.value) || 0;
            if (itemName && itemName.trim()) {
                items.push({ item_name: itemName.trim(), amount });
            }
        });
        
        await apiCall(`/bills/${id}`, {
            method: 'PUT',
            body: JSON.stringify({
                previous_balance: parseFloat(document.getElementById('editPrevBalance').value) || 0,
                items: items
            })
        });
        renderBilling();
    });
    
    document.getElementById('addBillItemBtn').onclick = () => {
        const container = document.getElementById('billItemsContainer');
        const newRow = document.createElement('div');
        newRow.className = 'bill-item-row';
        newRow.style.cssText = 'display:flex; gap:10px; margin-top:5px;';
        newRow.innerHTML = `
            <input type="text" class="item-name" placeholder="Item name" style="flex:2;">
            <input type="number" class="item-amount" placeholder="Amount" step="0.01" style="flex:1;">
            <button type="button" class="btn-danger remove-item-btn" style="padding:5px 10px;">✖</button>
        `;
        container.appendChild(newRow);
        newRow.querySelector('.remove-item-btn').onclick = () => newRow.remove();
    };
};

window.deleteBill = async (id) => {
    if (confirm('Delete this bill?')) {
        const result = await apiCall(`/bills/${id}`, { method: 'DELETE' });
        if (result?.error) alert(result.error);
        else renderBilling();
    }
};

// ========== CREATE BILL MODAL ==========
async function showCreateBillModal() {
    const allProperties = await apiCall('/properties');
    const allRooms = await apiCall('/rooms');
    const allTenants = await apiCall('/tenants');
    
    if (!allProperties || allProperties.length === 0) {
        alert('No properties found. Please add a property first.');
        return;
    }
    
    const propertyOptions = allProperties.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
    
    const modalHtml = `<div class="modal-content" style="max-width:600px;">
        <h3>Create Bill</h3>
        <label>Select Property</label>
        <select id="billPropertyId">${propertyOptions}</select>
        <label>Select Unit (Room)</label>
        <select id="billRoomId"><option value="">-- Select property first --</option></select>
        <label>Select Tenant</label>
        <select id="billTenantId"><option value="">-- Select unit first --</option></select>
        <label>Bill Month</label>
        <input type="month" id="billMonth" value="${new Date().toISOString().slice(0,7)}">
        <label>Previous Balance</label>
        <input type="number" id="billPreviousBalance" value="0" step="0.01">
        <label>Bill Items</label>
        <div id="billItemsContainer">
            <div class="bill-item-row" style="display:flex; gap:10px; margin-top:5px;">
                <input type="text" class="item-name" placeholder="Item name (e.g., Rent)" style="flex:2;">
                <input type="number" class="item-amount" placeholder="Amount" step="0.01" style="flex:1;">
                <button type="button" class="btn-danger remove-item-btn" style="padding:5px 10px;">✖</button>
            </div>
        </div>
        <button type="button" class="btn-add" id="addBillItemBtn" style="margin-top:10px;">+ Add Item</button>
        <div class="modal-buttons">
            <button class="btn-cancel" id="closeModalBtn">Cancel</button>
            <button class="btn-save" id="createBillConfirmBtn">Create Bill</button>
        </div>
    </div>`;
    
    showModal(modalHtml, null);
    
    setTimeout(() => {
        const propertySelect = document.getElementById('billPropertyId');
        const roomSelect = document.getElementById('billRoomId');
        const tenantSelect = document.getElementById('billTenantId');
        
        const updateRooms = () => {
            const propId = parseInt(propertySelect.value);
            const filteredRooms = allRooms.filter(r => r.property_id === propId);
            
            if (filteredRooms.length > 0) {
                roomSelect.innerHTML = '<option value="">-- Select a room --</option>' + 
                    filteredRooms.map(r => `<option value="${r.id}">${escapeHtml(r.house_no)} - ${escapeHtml(r.room_type)} (${r.status})</option>`).join('');
                roomSelect.disabled = false;
            } else {
                roomSelect.innerHTML = '<option value="">No rooms found</option>';
                roomSelect.disabled = true;
            }
            tenantSelect.innerHTML = '<option value="">-- Select unit first --</option>';
            tenantSelect.disabled = true;
        };
        
        const updateTenants = () => {
            const roomId = parseInt(roomSelect.value);
            if (roomId && roomSelect.disabled === false) {
                const tenantInRoom = allTenants.find(t => t.room_id === roomId && !t.is_deleted);
                if (tenantInRoom) {
                    tenantSelect.innerHTML = `<option value="${tenantInRoom.id}">${escapeHtml(tenantInRoom.first_name)} ${escapeHtml(tenantInRoom.last_name)}</option>`;
                    tenantSelect.disabled = false;
                } else {
                    tenantSelect.innerHTML = '<option value="">No tenant assigned</option>';
                    tenantSelect.disabled = true;
                }
            } else {
                tenantSelect.innerHTML = '<option value="">-- Select unit first --</option>';
                tenantSelect.disabled = true;
            }
        };
        
        propertySelect.onchange = updateRooms;
        roomSelect.onchange = updateTenants;
        
        const addBillBtn = document.getElementById('addBillItemBtn');
        if (addBillBtn) {
            addBillBtn.onclick = () => {
                const container = document.getElementById('billItemsContainer');
                const newRow = document.createElement('div');
                newRow.className = 'bill-item-row';
                newRow.style.cssText = 'display:flex; gap:10px; margin-top:5px;';
                newRow.innerHTML = `
                    <input type="text" class="item-name" placeholder="Item name" style="flex:2;">
                    <input type="number" class="item-amount" placeholder="Amount" step="0.01" style="flex:1;">
                    <button type="button" class="btn-danger remove-item-btn" style="padding:5px 10px;">✖</button>
                `;
                container.appendChild(newRow);
                newRow.querySelector('.remove-item-btn').onclick = () => newRow.remove();
            };
        }
        
        const createConfirmBtn = document.getElementById('createBillConfirmBtn');
        if (createConfirmBtn) {
            createConfirmBtn.onclick = async () => {
                const items = [];
                document.querySelectorAll('.bill-item-row').forEach(row => {
                    const itemName = row.querySelector('.item-name')?.value;
                    const amount = parseFloat(row.querySelector('.item-amount')?.value) || 0;
                    if (itemName && itemName.trim() && amount > 0) {
                        items.push({ item_name: itemName.trim(), amount });
                    }
                });
                
                const tenantId = document.getElementById('billTenantId').value;
                const propertyId = document.getElementById('billPropertyId').value;
                const roomId = document.getElementById('billRoomId').value;
                const billMonth = document.getElementById('billMonth').value;
                const previousBalance = parseFloat(document.getElementById('billPreviousBalance').value) || 0;
                
                if (!tenantId || !propertyId || !roomId) {
                    alert('Please select property, room, and tenant');
                    return;
                }
                
                if (items.length === 0) {
                    alert('Please add at least one bill item');
                    return;
                }
                
                const [year, month] = billMonth.split('-');
                const billMonthDate = new Date(year, month - 1, 1);
                
                const requestBody = {
                    tenant_id: parseInt(tenantId),
                    property_id: parseInt(propertyId),
                    room_id: parseInt(roomId),
                    bill_month: billMonthDate,
                    previous_balance: previousBalance,
                    items: items
                };
                
                const result = await apiCall('/bills', {
                    method: 'POST',
                    body: JSON.stringify(requestBody)
                });
                
                if (result?.error) {
                    alert('Error: ' + result.error);
                } else {
                    alert('Bill created successfully!');
                    document.querySelector('.modal')?.remove();
                    renderBilling();
                }
            };
        }
        
        updateRooms();
    }, 200);
}

// ========== AUTO GENERATE MODAL ==========
function showAutoGenerateModal() {
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1;
    const defaultMonth = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
    
    const modalHtml = `<div class="modal-content">
        <h3>Auto Generate Bills</h3>
        <label>Select Month</label>
        <input type="month" id="genMonth" value="${defaultMonth}">
        <p style="margin-top:10px; font-size:12px; color:#666;">
            This will generate rent bills for ALL active tenants for the selected month.<br>
            Bills will include: Rent (from assigned room)
        </p>
        <div class="modal-buttons">
            <button class="btn-cancel" id="closeModalBtn">Cancel</button>
            <button class="btn-save" id="generateBtn">Generate Bills</button>
        </div>
    </div>`;
    
    showModal(modalHtml, null);
    
    setTimeout(() => {
        const generateBtn = document.getElementById('generateBtn');
        if (generateBtn) {
            generateBtn.onclick = async () => {
                const monthValue = document.getElementById('genMonth').value;
                if (!monthValue) {
                    alert('Please select a month');
                    return;
                }
                
                const [year, month] = monthValue.split('-');
                
                generateBtn.disabled = true;
                generateBtn.textContent = 'Generating...';
                
                try {
                    const result = await apiCall('/bills/auto-generate', {
                        method: 'POST',
                        body: JSON.stringify({ year: parseInt(year), month: parseInt(month) })
                    });
                    
                    if (result?.error) {
                        alert('Error: ' + result.error);
                    } else {
                        alert(result?.message || 'Bills generated successfully!');
                        document.querySelector('.modal')?.remove();
                        renderBilling();
                    }
                } catch (error) {
                    alert('Error generating bills: ' + error.message);
                } finally {
                    generateBtn.disabled = false;
                    generateBtn.textContent = 'Generate Bills';
                }
            };
        }
    }, 100);
}

// ========== BULK CREATE MODAL ==========
function showBulkCreateModal() {
    const modalHtml = `<div class="modal-content" style="max-width:500px;">
        <h3>Bulk Create Bills for Property</h3>
        <label>Select Property *</label>
        <select id="bulkPropertyId">
            <option value="">-- Select Property --</option>
        </select>
        <label>Bill Month *</label>
        <input type="month" id="bulkBillMonth" value="${new Date().toISOString().slice(0,7)}">
        <label>Bill Item Name *</label>
        <input type="text" id="bulkItemName" placeholder="e.g., Water Bill, Electricity, Service Charge">
        <label>Amount per Tenant (KES) *</label>
        <input type="number" id="bulkAmount" step="0.01" placeholder="Enter amount">
        <p style="margin-top:10px; font-size:12px; color:#666;">
            This will add this bill to ALL active tenants in the selected property.<br>
            If a rent bill already exists for the month, this amount will be ADDED to it.
        </p>
        <div class="modal-buttons">
            <button class="btn-cancel" id="closeModalBtn">Cancel</button>
            <button class="btn-save" id="createBulkBtn">Create Bills</button>
        </div>
    </div>`;
    
    showModal(modalHtml, null);
    
    setTimeout(async () => {
        const properties = await apiCall('/properties');
        const propSelect = document.getElementById('bulkPropertyId');
        if (propSelect && properties) {
            propSelect.innerHTML = '<option value="">-- Select Property --</option>' + 
                properties.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
        }
        
        const createBtn = document.getElementById('createBulkBtn');
        if (createBtn) {
            createBtn.onclick = async () => {
                const propertyId = document.getElementById('bulkPropertyId').value;
                const billMonth = document.getElementById('bulkBillMonth').value;
                const itemName = document.getElementById('bulkItemName').value;
                const amount = parseFloat(document.getElementById('bulkAmount').value);
                
                if (!propertyId || !billMonth || !itemName || !amount) {
                    alert('Please fill all fields');
                    return;
                }
                
                const [year, month] = billMonth.split('-');
                const billMonthDate = new Date(year, month - 1, 1);
                
                createBtn.disabled = true;
                createBtn.textContent = 'Creating...';
                
                const result = await apiCall('/bills/bulk-property', {
                    method: 'POST',
                    body: JSON.stringify({
                        property_id: parseInt(propertyId),
                        bill_month: billMonthDate,
                        item_name: itemName,
                        amount: amount
                    })
                });
                
                if (result?.error) {
                    alert('Error: ' + result.error);
                } else {
                    alert(result.message);
                    document.querySelector('.modal')?.remove();
                    renderBilling();
                }
                
                createBtn.disabled = false;
                createBtn.textContent = 'Create Bills';
            };
        }
    }, 100);
}

// ========== AWARD PENALTY MODAL ==========
function showAwardPenaltyModal() {
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1;
    
    const modalHtml = `<div class="modal-content">
        <h3>Award Late Payment Penalties</h3>
        <label>Select Month</label>
        <input type="month" id="penaltyMonth" value="${currentYear}-${String(currentMonth).padStart(2,'0')}">
        <p style="margin-top:10px; font-size:12px; color:#666;">
            This will check all tenants for unpaid rent from the PREVIOUS month.<br>
            Penalties will be awarded on the 6th of the selected month.<br>
            SMS notifications will be sent to tenants with arrears.
        </p>
        <div class="modal-buttons">
            <button class="btn-cancel" id="closeModalBtn">Cancel</button>
            <button class="btn-save" id="confirmPenaltyBtn">Award Penalties</button>
        </div>
    </div>`;
    
    showModal(modalHtml, null);
    
    setTimeout(() => {
        const confirmBtn = document.getElementById('confirmPenaltyBtn');
        if (confirmBtn) {
            confirmBtn.onclick = async () => {
                const monthYear = document.getElementById('penaltyMonth').value;
                if (!monthYear) {
                    alert('Please select a month');
                    return;
                }
                
                const [year, month] = monthYear.split('-');
                
                confirmBtn.disabled = true;
                confirmBtn.textContent = 'Processing...';
                
                const result = await apiCall('/bills/award-penalties', {
                    method: 'POST',
                    body: JSON.stringify({ year: parseInt(year), month: parseInt(month) })
                });
                
                if (result?.error) {
                    alert('Error: ' + result.error);
                } else {
                    alert(result.message);
                    document.querySelector('.modal')?.remove();
                    renderBilling();
                }
                
                confirmBtn.disabled = false;
                confirmBtn.textContent = 'Award Penalties';
            };
        }
    }, 100);
}

// ========== PAYMENTS SECTION ==========
async function renderPayments() {
    const content = document.getElementById('content');
    
    const filterData = await apiCall('/payments/filters/data');
    const properties = filterData?.properties || [];
    const tenants = filterData?.tenants || [];
    
    content.innerHTML = `
        <div style="display:flex; justify-content:flex-end; margin-bottom:15px;">
            <button class="btn-add" id="addPaymentBtn">+ Record Payment</button>
            <button class="btn-add" id="unassignedBtn" style="background:#f39c12; margin-left:10px;">⚠ Unassigned Payments</button>
        </div>
        <div class="cards" id="summaryCards" style="margin-bottom:20px;">
            <div class="card"><h4>Total Payments</h4><div class="value" id="totalPayments">KES 0</div></div>
            <div class="card"><h4>Manual</h4><div class="value" id="manualTotal">KES 0</div></div>
            <div class="card"><h4>Auto (M-Pesa)</h4><div class="value" id="autoTotal">KES 0</div></div>
        </div>
        <div class="filters">
            <input type="text" id="searchPayment" class="filter-input" placeholder="Search tenant name/room" style="width:200px;">
            <select id="filterPropertyPayment" class="filter-input">
                <option value="">All Properties</option>
                ${properties.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}
            </select>
            <select id="filterSource" class="filter-input">
                <option value="">All Sources</option>
                <option value="manual">Manual</option>
                <option value="auto">Auto (M-Pesa)</option>
            </select>
            <input type="date" id="filterDateFrom" class="filter-input" placeholder="From Date">
            <input type="date" id="filterDateTo" class="filter-input" placeholder="To Date">
            <button class="btn-add" id="downloadCSVBtn" style="background:#5cb85c;">Download CSV</button>
            <button class="btn-add" id="downloadPDFBtn" style="background:#e74c3c;">Download PDF</button>
        </div>
        <div id="paymentsList" class="loading">Loading payments...</div>
        <div id="pagination-container"></div>
    `;
    
    document.getElementById('addPaymentBtn').onclick = () => showAddPaymentModal(properties, tenants);
    document.getElementById('unassignedBtn').onclick = () => showUnassignedPaymentsModal();
    document.getElementById('downloadCSVBtn').onclick = () => downloadPaymentsCSV();
    document.getElementById('downloadPDFBtn').onclick = () => downloadPaymentsPDF();
    
    let allPayments = [];
    
    async function loadPayments() {
        allPayments = await apiCall('/payments');
        if (!allPayments) return;
        await updateSummary();
        filterPayments();
    }
    
    async function updateSummary() {
        const startDate = document.getElementById('filterDateFrom')?.value || '';
        const endDate = document.getElementById('filterDateTo')?.value || '';
        const propertyId = document.getElementById('filterPropertyPayment')?.value || '';
        const source = document.getElementById('filterSource')?.value || '';
        
        let url = `/payments/summary/stats?`;
        if (startDate) url += `start_date=${startDate}&`;
        if (endDate) url += `end_date=${endDate}&`;
        if (propertyId) url += `property_id=${propertyId}&`;
        if (source && source !== 'all') url += `source=${source}&`;
        
        const stats = await apiCall(url);
        if (stats) {
            document.getElementById('totalPayments').innerHTML = `KES ${formatNumber(stats.total)}`;
            document.getElementById('manualTotal').innerHTML = `KES ${formatNumber(stats.manual_total)}`;
            document.getElementById('autoTotal').innerHTML = `KES ${formatNumber(stats.auto_total)}`;
        }
    }
    
    function filterPayments() {
        const search = document.getElementById('searchPayment')?.value.toLowerCase() || '';
        const propertyId = document.getElementById('filterPropertyPayment')?.value || '';
        const source = document.getElementById('filterSource')?.value || '';
        const dateFrom = document.getElementById('filterDateFrom')?.value || '';
        const dateTo = document.getElementById('filterDateTo')?.value || '';
        
        let filtered = [...allPayments];
        
        if (search) {
            filtered = filtered.filter(p => 
                p.first_name?.toLowerCase().includes(search) || 
                p.last_name?.toLowerCase().includes(search) ||
                p.house_no?.toLowerCase().includes(search)
            );
        }
        if (propertyId) filtered = filtered.filter(p => p.property_id == propertyId);
        if (source) filtered = filtered.filter(p => p.source === source);
        if (dateFrom) filtered = filtered.filter(p => p.payment_date >= dateFrom);
        if (dateTo) filtered = filtered.filter(p => p.payment_date <= dateTo);
        
        currentPage = 1;
        renderPaymentsTable(filtered);
        updateSummary();
    }
    
    function renderPaymentsTable(data) {
        currentData = data;
        const totalItems = data.length;
        const paginatedData = getPaginatedData(data);
        
        if(paginatedData.length === 0 && totalItems > 0) {
            currentPage = Math.ceil(totalItems / itemsPerPage);
            renderPaymentsTable(data);
            return;
        }
        
        if(paginatedData.length === 0){ 
            document.getElementById('paymentsList').innerHTML = '<div class="empty-state">No payments found.</div>'; 
            renderPagination('pagination-container', totalItems, () => renderPaymentsTable(currentData));
            return; 
        }
        
        let html = `<div class="table-wrapper"><table class="payments-table"><thead>
            <tr><th>Tenant</th><th>Property</th><th>Unit</th><th>Status</th><th>Amount Paid</th><th>Date</th><th>Source</th><th>Actions</th></tr>
        </thead><tbody>`;
        
        paginatedData.forEach(p => {
            const sourceText = p.source === 'manual' ? 'Manual' : 'Auto (M-Pesa)';
            const sourceClass = p.source === 'manual' ? 'status-vacated' : 'status-active';
            
            html += `<tr>
                <td><strong>${escapeHtml(p.first_name)} ${escapeHtml(p.last_name)}</strong></td>
                <td>${escapeHtml(p.property_name)}</td>
                <td>${escapeHtml(p.house_no)}</td>
                <td><span class="status-active">Completed</span></td>
                <td>KES ${formatNumber(p.amount)}</td>
                <td>${formatDate(p.payment_date)}</td>
                <td><span class="${sourceClass}">${sourceText}</span></td>
                <td class="action-buttons">
                    <select class="payment-action-select" data-id="${p.id}" style="padding:5px; border-radius:4px;">
                        <option value="">Actions</option>
                        <option value="edit">Edit</option>
                        <option value="receipt">Send Receipt</option>
                        <option value="download">Download Receipt</option>
                        <option value="delete">Delete</option>
                    </select>
                </td>
            </tr>`;
        });
        
        html += `</tbody></table></div>`;
        document.getElementById('paymentsList').innerHTML = html;
        renderPagination('pagination-container', totalItems, () => renderPaymentsTable(currentData));
        
        document.querySelectorAll('.payment-action-select').forEach(select => {
            select.onchange = async () => {
                const action = select.value;
                const paymentId = select.getAttribute('data-id');
                if (!action) return;
                
                select.value = '';
                
                if (action === 'edit') {
                    await editPayment(paymentId);
                } else if (action === 'receipt') {
                    await sendReceipt(paymentId);
                } else if (action === 'download') {
                    await downloadReceipt(paymentId);
                } else if (action === 'delete') {
                    await deletePayment(paymentId);
                }
            };
        });
    }
    
    const filterIds = ['searchPayment', 'filterPropertyPayment', 'filterSource', 'filterDateFrom', 'filterDateTo'];
    filterIds.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.addEventListener('input', filterPayments);
            element.addEventListener('change', filterPayments);
        }
    });
    
    await loadPayments();
}

// ========== ADD PAYMENT MODAL ==========
async function showAddPaymentModal(properties, tenants) {
    const propertyOptions = properties.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
    
    const modalHtml = `<div class="modal-content" style="max-width:500px;">
        <h3>Record Payment</h3>
        <label>Select Property</label>
        <select id="paymentPropertyId">${propertyOptions}</select>
        <label>Select Unit (Room)</label>
        <select id="paymentRoomId"><option>Select property first</option></select>
        <label>Tenant</label>
        <select id="paymentTenantId" disabled><option>Select unit first</option></select>
        <label>Amount (KES) *</label>
        <input type="number" id="paymentAmount" step="0.01" placeholder="Enter amount">
        <label>Payment Date</label>
        <input type="date" id="paymentDate" value="${new Date().toISOString().split('T')[0]}">
        <label>Payment Type</label>
        <select id="paymentType">
            <option value="rent">Rent</option>
            <option value="deposit">Deposit</option>
            <option value="penalty">Penalty</option>
        </select>
        <label>Transaction ID (Optional)</label>
        <input type="text" id="transactionId" placeholder="M-Pesa transaction ID">
        <label>Notes (Optional)</label>
        <textarea id="paymentNotes" rows="2" placeholder="Additional notes"></textarea>
        <label>Admin Password *</label>
        <input type="password" id="adminPassword" placeholder="Enter your password">
        <div class="modal-buttons">
            <button class="btn-cancel" id="closeModalBtn">Cancel</button>
            <button class="btn-save" id="savePaymentBtn">Save Payment</button>
        </div>
    </div>`;
    
    showModal(modalHtml, null);
    
    setTimeout(async () => {
        const propertySelect = document.getElementById('paymentPropertyId');
        const roomSelect = document.getElementById('paymentRoomId');
        const tenantSelect = document.getElementById('paymentTenantId');
        const allRooms = await apiCall('/rooms');
        const allTenants = await apiCall('/tenants');
        
        const updateRooms = () => {
            const propId = parseInt(propertySelect.value);
            const filteredRooms = allRooms.filter(r => r.property_id === propId);
            if (filteredRooms.length > 0) {
                roomSelect.innerHTML = '<option value="">-- Select a room --</option>' + 
                    filteredRooms.map(r => `<option value="${r.id}">${escapeHtml(r.house_no)} - ${escapeHtml(r.room_type)}</option>`).join('');
                roomSelect.disabled = false;
            } else {
                roomSelect.innerHTML = '<option value="">No rooms found</option>';
                roomSelect.disabled = true;
            }
            tenantSelect.innerHTML = '<option value="">Select unit first</option>';
            tenantSelect.disabled = true;
        };
        
        const updateTenants = () => {
            const roomId = parseInt(roomSelect.value);
            if (roomId) {
                const tenantInRoom = allTenants.find(t => t.room_id === roomId && !t.is_deleted);
                if (tenantInRoom) {
                    tenantSelect.innerHTML = `<option value="${tenantInRoom.id}">${escapeHtml(tenantInRoom.first_name)} ${escapeHtml(tenantInRoom.last_name)}</option>`;
                    tenantSelect.disabled = false;
                } else {
                    tenantSelect.innerHTML = '<option value="">No tenant assigned</option>';
                    tenantSelect.disabled = true;
                }
            }
        };
        
        propertySelect.onchange = updateRooms;
        roomSelect.onchange = updateTenants;
        updateRooms();
        
        const saveBtn = document.getElementById('savePaymentBtn');
        if (saveBtn) {
            saveBtn.onclick = async () => {
                const tenantId = tenantSelect.value;
                const amount = parseFloat(document.getElementById('paymentAmount').value);
                const paymentDate = document.getElementById('paymentDate').value;
                const paymentType = document.getElementById('paymentType').value;
                const transactionId = document.getElementById('transactionId').value;
                const notes = document.getElementById('paymentNotes').value;
                const password = document.getElementById('adminPassword').value;
                
                if (!tenantId || !amount || amount <= 0) {
                    alert('Please select a tenant and enter a valid amount');
                    return;
                }
                if (!password) {
                    alert('Please enter your admin password');
                    return;
                }
                
                const result = await apiCall('/payments', {
                    method: 'POST',
                    body: JSON.stringify({
                        tenant_id: parseInt(tenantId),
                        amount: amount,
                        payment_date: paymentDate,
                        payment_type: paymentType,
                        transaction_id: transactionId,
                        notes: notes,
                        password: password
                    })
                });
                
                if (result?.error) {
                    alert('Error: ' + result.error);
                } else {
                    alert('Payment recorded successfully!');
                    document.querySelector('.modal')?.remove();
                    renderPayments();
                    renderBilling();
                    renderTenantList();
                }
            };
        }
    }, 100);
}

// ========== EDIT PAYMENT ==========
async function editPayment(paymentId) {
    const payment = await apiCall(`/payments/${paymentId}`);
    if (!payment) return;
    
    // Only deposit and penalty can be edited
    if (payment.payment_type !== 'deposit' && payment.payment_type !== 'penalty') {
        alert('Rent payments cannot be edited. Only deposit and penalty can be modified.');
        return;
    }
    
    const modalHtml = `<div class="modal-content" style="max-width:500px;">
        <h3>Edit ${payment.payment_type.toUpperCase()} Payment</h3>
        <label>Amount (KES)</label>
        <input type="number" id="editAmount" value="${payment.amount}" step="0.01">
        <label>Payment Date</label>
        <input type="date" id="editDate" value="${payment.payment_date.split('T')[0]}">
        <label>Payment Type</label>
        <select id="editType">
            <option value="deposit" ${payment.payment_type === 'deposit' ? 'selected' : ''}>Deposit</option>
            <option value="penalty" ${payment.payment_type === 'penalty' ? 'selected' : ''}>Penalty</option>
        </select>
        <label>Transaction ID</label>
        <input type="text" id="editTransactionId" value="${payment.transaction_id || ''}">
        <label>Reason for Edit *</label>
        <input type="text" id="editReason" placeholder="Why are you editing this payment?" required>
        <label>Admin Password *</label>
        <input type="password" id="adminPassword" placeholder="Enter your password">
        <div class="modal-buttons">
            <button class="btn-cancel" id="closeModalBtn">Cancel</button>
            <button class="btn-save" id="saveEditBtn">Save Changes</button>
        </div>
    </div>`;
    
    showModal(modalHtml, null);
    
    setTimeout(() => {
       document.getElementById('savePaymentBtn').onclick = async () => {
    const tenantId = tenantSelect.value;
    const amount = parseFloat(document.getElementById('paymentAmount').value);
    const paymentDate = document.getElementById('paymentDate').value;
    const paymentType = document.getElementById('paymentType').value;
    const transactionId = document.getElementById('transactionId').value;
    const notes = document.getElementById('paymentNotes').value;
    const password = document.getElementById('adminPassword').value;
    
    if (!tenantId || !amount || amount <= 0) {
        alert('Please select a tenant and enter a valid amount');
        return;
    }
    if (!password) {
        alert('Please enter your admin password');
        return;
    }
    
    const result = await apiCall('/payments', {
        method: 'POST',
        body: JSON.stringify({
            tenant_id: parseInt(tenantId),
            amount: amount,
            payment_date: paymentDate,
            payment_type: paymentType,
            transaction_id: transactionId,
            notes: notes,
            password: password
        })
    });
    
    if (result?.error) {
        alert('Error: ' + result.error);
    } else {
        alert('Payment recorded successfully!');
        const modal = document.querySelector('.modal');
        if (modal) modal.remove();
        
        // Force refresh all data
        renderPayments();
        renderBilling();
        renderTenants();  // This updates the tenants table
    }
};
    }, 100);
}

// ========== DELETE PAYMENT ==========
async function deletePayment(paymentId) {
    const modalHtml = `<div class="modal-content" style="max-width:400px;">
        <h3>Delete Payment</h3>
        <p>Are you sure you want to delete this payment?</p>
        <p style="color:#e74c3c; font-size:12px;">This action cannot be undone and will recalculate the tenant's bill.</p>
        <label>Admin Password *</label>
        <input type="password" id="adminPassword" placeholder="Enter your password">
        <div class="modal-buttons">
            <button class="btn-cancel" id="closeModalBtn">Cancel</button>
            <button class="btn-danger" id="confirmDeleteBtn">Delete Payment</button>
        </div>
    </div>`;
    
    showModal(modalHtml, null);
    
    setTimeout(() => {
        const deleteBtn = document.getElementById('confirmDeleteBtn');
        if (deleteBtn) {
            deleteBtn.onclick = async () => {
                const password = document.getElementById('adminPassword').value;
                
                if (!password) {
                    alert('Please enter your admin password');
                    return;
                }
                
                const result = await apiCall(`/payments/${paymentId}`, {
                    method: 'DELETE',
                    body: JSON.stringify({ password: password })
                });
                
                if (result?.error) {
                    alert('Error: ' + result.error);
                } else {
                    alert('Payment deleted successfully!');
                    document.querySelector('.modal')?.remove();
                    renderPayments();
                    renderBilling();
                }
            };
        }
    }, 100);
}

// ========== SEND RECEIPT ==========
async function sendReceipt(paymentId) {
    const payment = await apiCall(`/payments/${paymentId}`);
    if (!payment) return;
    
    const receiptUrl = `${window.location.origin}/receipt/${paymentId}`;
    const smsMessage = `Payment Confirmation: KES ${formatNumber(payment.amount)} received from ${payment.first_name} ${payment.last_name}. View receipt: ${receiptUrl}`;
    
    alert(`SMS would be sent to ${payment.phone}\n\nMessage: ${smsMessage}\n\n(SMS provider not configured yet - this is a placeholder)`);
    
    await apiCall(`/payments/${paymentId}/receipt-sent`, { method: 'PUT' });
}

// ========== DOWNLOAD RECEIPT ==========
async function downloadReceipt(paymentId) {
    const payment = await apiCall(`/payments/${paymentId}`);
    if (!payment) return;
    
    const tenant = await apiCall(`/tenants/${payment.tenant_id}`);
    const room = await apiCall(`/rooms/${tenant.room_id}`);
    const companyName = localStorage.getItem('companyName') || 'Rental Management System';
    
    let accountNumber = room?.house_no || tenant.account_number;
    if (payment.payment_type === 'deposit') {
        accountNumber = `D${room?.house_no}`;
    } else if (payment.payment_type === 'penalty') {
        accountNumber = `P${room?.house_no}`;
    }
    
    const currentBalance = tenant.balance || 0;
    const balanceDisplay = currentBalance < 0 ? `- KES ${formatNumber(Math.abs(currentBalance))}` : `KES ${formatNumber(currentBalance)}`;
    
    const beingPaymentOf = calculateBeingPaymentOf(payment.tenant_id, payment.amount, payment.payment_date);
    
    const receiptHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Receipt_${payment.id}</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 0; padding: 20px; }
                .receipt { max-width: 400px; margin: 0 auto; border: 1px solid #ddd; padding: 20px; }
                .header { text-align: center; margin-bottom: 20px; }
                .company { font-size: 18px; font-weight: bold; text-align: center; }
                .ref { text-align: right; font-size: 12px; color: #666; }
                .date { text-align: right; font-size: 12px; color: #666; margin-top: 5px; }
                .divider { border-top: 1px dashed #ddd; margin: 15px 0; }
                .row { display: flex; justify-content: flex-start; margin: 8px 0; }
                .row span:first-child { width: 120px; font-weight: bold; }
                .total-row { font-weight: bold; margin-top: 10px; padding-top: 10px; border-top: 1px solid #ddd; }
                .footer { text-align: center; font-size: 10px; color: #888; margin-top: 20px; }
                table { width: 100%; border-collapse: collapse; margin: 10px 0; }
                th, td { text-align: left; padding: 5px 0; }
                td:last-child { text-align: right; }
            </style>
        </head>
        <body>
            <div class="receipt">
                <div class="ref">Ref: RCPT-${payment.id}</div>
                <div class="date">Date: ${formatDate(payment.payment_date)}</div>
                <div class="header">
                    <div class="company">${escapeHtml(companyName)}</div>
                </div>
                <div class="divider"></div>
                <div class="row"><span>Paid By:</span><span>${escapeHtml(tenant.first_name)} ${escapeHtml(tenant.last_name)}</span></div>
                <div class="row"><span>Account NO:</span><span>${escapeHtml(accountNumber)}</span></div>
                <div class="row"><span>Property:</span><span>${escapeHtml(payment.property_name)}</span></div>
                <div class="divider"></div>
                <table>
                    <thead><tr><th>ITEM</th><th>Total</th></tr></thead>
                    <tbody>
                        <tr><td>${payment.payment_type.toUpperCase()}</td><td>KES ${formatNumber(payment.amount)}</td></tr>
                    </tbody>
                </table>
                <div class="row total-row"><span>Total:</span><span>KES ${formatNumber(payment.amount)}</span></div>
                <div class="row"><span>Total Paid:</span><span>KES ${formatNumber(payment.amount)}</span></div>
                <div class="row"><span>Current Balance:</span><span>${balanceDisplay}</span></div>
                <div class="divider"></div>
                <div class="row"><span>Being Payment of:</span><span>${beingPaymentOf}</span></div>
                <div class="divider"></div>
                <div class="footer">This receipt was created by computer and is valid without signature and seal.</div>
            </div>
        </body>
        </html>
    `;
    
    const blob = new Blob([receiptHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Receipt_${payment.id}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function calculateBeingPaymentOf(tenantId, amount, paymentDate) {
    const date = new Date(paymentDate);
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const currentMonth = monthNames[date.getMonth()];
    const currentYear = date.getFullYear();
    return `${currentMonth} ${currentYear}`;
}

// ========== UNASSIGNED PAYMENTS ==========
async function showUnassignedPaymentsModal() {
    const unassigned = await apiCall('/webhooks/unassigned');
    const rooms = await apiCall('/rooms');
    
    if (!unassigned || unassigned.length === 0) {
        alert('No unassigned payments found');
        return;
    }
    
    let unassignedHtml = '<div class="table-wrapper"><table style="width:100%;"><thead><tr><th>Account No</th><th>Amount</th><th>Date</th><th>Assign To</th><th>Action</th></tr></thead><tbody>';
    unassigned.forEach(p => {
        unassignedHtml += `<tr id="unassigned-row-${p.id}">
            <td>${escapeHtml(p.account_number)}</td>
            <td>KES ${formatNumber(p.amount)}</td>
            <td>${formatDate(p.payment_date)}</td>
            <td>
                <select id="assign-room-${p.id}" class="filter-input" style="width:150px;">
                    <option value="">Select Room</option>
                    ${rooms.map(r => `<option value="${r.id}">${escapeHtml(r.house_no)}</option>`).join('')}
                </select>
            </td>
            <td><button class="btn-save" onclick="assignUnassignedPayment(${p.id})">Assign</button></td>
        </tr>`;
    });
    unassignedHtml += `</tbody></table></div>
        <div class="modal-buttons"><button class="btn-cancel" id="closeModalBtn">Close</button></div>`;
    
    showModal(unassignedHtml, null);
    
    window.assignUnassignedPayment = async (paymentId) => {
        const roomId = document.getElementById(`assign-room-${paymentId}`).value;
        const password = prompt('Enter admin password to assign this payment:');
        
        if (!roomId) {
            alert('Please select a room');
            return;
        }
        if (!password) {
            alert('Password required');
            return;
        }
        
        const result = await apiCall(`/webhooks/unassigned/assign/${paymentId}`, {
            method: 'POST',
            body: JSON.stringify({ room_id: parseInt(roomId), password: password })
        });
        
        if (result?.error) {
            alert('Error: ' + result.error);
        } else {
            alert('Payment assigned successfully!');
            document.querySelector('.modal')?.remove();
            renderPayments();
            renderBilling();
        }
    };
}

// ========== DOWNLOAD PAYMENTS ==========
async function downloadPaymentsCSV() {
    const payments = await apiCall('/payments');
    if (!payments || payments.length === 0) {
        alert('No payments to download');
        return;
    }
    
    let csv = 'Tenant,Property,Unit,Amount,Payment Date,Type,Source,Transaction ID,Notes\n';
    payments.forEach(p => {
        csv += `"${p.first_name} ${p.last_name}","${p.property_name}","${p.house_no}",${p.amount},${p.payment_date},${p.payment_type},${p.source},${p.transaction_id || ''},"${p.notes || ''}"\n`;
    });
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payments_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

async function downloadPaymentsPDF() {
    const payments = await apiCall('/payments');
    if (!payments || payments.length === 0) {
        alert('No payments to download');
        return;
    }
    
    let html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Payments Report</title><style>body{font-family:Arial;margin:20px;}table{width:100%;border-collapse:collapse;}th,td{border:1px solid #ddd;padding:8px;text-align:left;}th{background:#f5f5f5;}</style></head><body>';
    html += '<h2>Payments Report</h2>';
    html += `<p>Generated: ${new Date().toLocaleString()}</p>`;
    html += '<table><thead><tr><th>Tenant</th><th>Property</th><th>Unit</th><th>Amount</th><th>Date</th><th>Type</th><th>Source</th></tr></thead><tbody>';
    
    payments.forEach(p => {
        html += `<tr>
            <td>${p.first_name} ${p.last_name}</td>
            <td>${p.property_name || ''}</td>
            <td>${p.house_no || ''}</td>
            <td>KES ${formatNumber(p.amount)}</td>
            <td>${formatDate(p.payment_date)}</td>
            <td>${p.payment_type}</td>
            <td>${p.source === 'manual' ? 'Manual' : 'Auto'}</td>
        </tr>`;
    });
    
    html += '</tbody></table></body></html>';
    
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payments_report_${new Date().toISOString().split('T')[0]}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ========== SHOW ADD EXPENSE MODAL ==========
async function showAddExpenseModal() {
    const properties = await apiCall('/properties');
    const categories = await apiCall('/financials/expense-categories');
    const allRooms = await apiCall('/rooms');
    
    if (!properties || properties.length === 0) {
        alert('Please add a property first');
        return;
    }
    
    const propertyOptions = properties.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
    const categoryOptions = categories ? categories.map(c => `<option value="${c}">${c}</option>`).join('') : '';
    
    const modalHtml = `<div class="modal-content" style="max-width:500px;">
        <h3>Add Expense</h3>
        <label>Property *</label>
        <select id="expensePropertyId">${propertyOptions}</select>
        <label>Unit (Optional)</label>
        <select id="expenseRoomId"><option value="">-- None --</option></select>
        <label>Amount (KES) *</label>
        <input type="number" id="expenseAmount" step="0.01">
        <label>Category *</label>
        <select id="expenseCategory">${categoryOptions}</select>
        <label>Date *</label>
        <input type="date" id="expenseDate" value="${new Date().toISOString().split('T')[0]}">
        <label>Status *</label>
        <select id="expenseStatus">
            <option value="finished">Finished</option>
            <option value="in_progress">In Progress</option>
        </select>
        <label>Description (Optional)</label>
        <textarea id="expenseDescription" rows="2"></textarea>
        <label>Admin Password *</label>
        <input type="password" id="adminPassword">
        <div class="modal-buttons">
            <button class="btn-cancel" id="closeModalBtn">Cancel</button>
            <button class="btn-save" id="saveExpenseBtn">Save Expense</button>
        </div>
    </div>`;
    
    showModal(modalHtml, null);
    
    setTimeout(() => {
        const propertySelect = document.getElementById('expensePropertyId');
        const roomSelect = document.getElementById('expenseRoomId');
        
        if (propertySelect) {
            propertySelect.onchange = () => {
                const propId = propertySelect.value;
                const filteredRooms = allRooms ? allRooms.filter(r => r.property_id == propId) : [];
                roomSelect.innerHTML = '<option value="">-- None --</option>' + 
                    filteredRooms.map(r => `<option value="${r.id}">${escapeHtml(r.house_no)}</option>`).join('');
            };
            propertySelect.onchange();
        }
        
        const saveBtn = document.getElementById('saveExpenseBtn');
        if (saveBtn) {
            saveBtn.onclick = async () => {
                const propertyId = document.getElementById('expensePropertyId').value;
                const roomId = document.getElementById('expenseRoomId').value;
                const amount = parseFloat(document.getElementById('expenseAmount').value);
                const category = document.getElementById('expenseCategory').value;
                const expenseDate = document.getElementById('expenseDate').value;
                const status = document.getElementById('expenseStatus').value;
                const description = document.getElementById('expenseDescription').value;
                const password = document.getElementById('adminPassword').value;
                
                if (!propertyId || !amount || !category || !expenseDate || !password) {
                    alert('Please fill all required fields');
                    return;
                }
                
                const result = await apiCall('/financials/expenses', {
                    method: 'POST',
                    body: JSON.stringify({
                        property_id: parseInt(propertyId),
                        room_id: roomId ? parseInt(roomId) : null,
                        amount: amount,
                        category: category,
                        expense_date: expenseDate,
                        status: status,
                        description: description,
                        password: password
                    })
                });
                
                if (result?.error) {
                    alert('Error: ' + result.error);
                } else {
                    alert('Expense added successfully!');
                    document.querySelector('.modal')?.remove();
                    renderExpensesContent();
                }
            };
        }
    }, 100);
}

window.editExpense = async (id) => {
    const expense = await apiCall(`/financials/expenses/${id}`);
    if (!expense) return;
    
    const properties = await apiCall('/properties');
    const categories = await apiCall('/financials/expense-categories');
    const allRooms = await apiCall('/rooms');
    
    const propertyOptions = properties.map(p => `<option value="${p.id}" ${p.id === expense.property_id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('');
    const categoryOptions = categories.map(c => `<option value="${c}" ${c === expense.category ? 'selected' : ''}>${c}</option>`).join('');
    
    const roomsForProperty = allRooms.filter(r => r.property_id === expense.property_id);
    const roomOptions = '<option value="">-- None --</option>' + 
        roomsForProperty.map(r => `<option value="${r.id}" ${r.id === expense.room_id ? 'selected' : ''}>${escapeHtml(r.house_no)}</option>`).join('');
    
    const modalHtml = `<div class="modal-content" style="max-width:500px;">
        <h3>Edit Expense</h3>
        <label>Property</label><select id="expensePropertyId">${propertyOptions}</select>
        <label>Unit (Optional)</label><select id="expenseRoomId">${roomOptions}</select>
        <label>Amount (KES)</label><input type="number" id="expenseAmount" value="${expense.amount}" step="0.01">
        <label>Category</label><select id="expenseCategory">${categoryOptions}</select>
        <label>Date</label><input type="date" id="expenseDate" value="${expense.expense_date.split('T')[0]}">
        <label>Status</label><select id="expenseStatus">
            <option value="finished" ${expense.status === 'finished' ? 'selected' : ''}>Finished</option>
            <option value="in_progress" ${expense.status === 'in_progress' ? 'selected' : ''}>In Progress</option>
        </select>
        <label>Description (Optional)</label><textarea id="expenseDescription" rows="2">${expense.description || ''}</textarea>
        <label>Admin Password</label><input type="password" id="adminPassword">
        <div class="modal-buttons">
            <button class="btn-cancel" id="closeModalBtn">Cancel</button>
            <button class="btn-save" id="saveExpenseBtn">Save Changes</button>
        </div>
    </div>`;
    
    showModal(modalHtml, null);
    
    setTimeout(() => {
        const propertySelect = document.getElementById('expensePropertyId');
        const roomSelect = document.getElementById('expenseRoomId');
        
        if (propertySelect) {
            propertySelect.onchange = () => {
                const propId = propertySelect.value;
                const filteredRooms = allRooms.filter(r => r.property_id == propId);
                roomSelect.innerHTML = '<option value="">-- None --</option>' + 
                    filteredRooms.map(r => `<option value="${r.id}">${escapeHtml(r.house_no)}</option>`).join('');
                if (expense.room_id && filteredRooms.some(r => r.id === expense.room_id)) {
                    roomSelect.value = expense.room_id;
                }
            };
        }
        
        const saveBtn = document.getElementById('saveExpenseBtn');
        if (saveBtn) {
            saveBtn.onclick = async () => {
                const propertyId = document.getElementById('expensePropertyId').value;
                const roomId = document.getElementById('expenseRoomId').value;
                const amount = parseFloat(document.getElementById('expenseAmount').value);
                const category = document.getElementById('expenseCategory').value;
                const expenseDate = document.getElementById('expenseDate').value;
                const status = document.getElementById('expenseStatus').value;
                const description = document.getElementById('expenseDescription').value;
                const password = document.getElementById('adminPassword').value;
                
                if (!propertyId || !amount || !category || !expenseDate || !password) {
                    alert('Please fill all required fields');
                    return;
                }
                
                const result = await apiCall(`/financials/expenses/${id}`, {
                    method: 'PUT',
                    body: JSON.stringify({
                        property_id: parseInt(propertyId),
                        room_id: roomId ? parseInt(roomId) : null,
                        amount: amount,
                        category: category,
                        expense_date: expenseDate,
                        status: status,
                        description: description,
                        password: password
                    })
                });
                
                if (result?.error) {
                    alert('Error: ' + result.error);
                } else {
                    alert('Expense updated successfully!');
                    document.querySelector('.modal')?.remove();
                    renderExpensesContent();
                }
            };
        }
    }, 100);
};

window.deleteExpense = async (id) => {
    const password = prompt('Enter admin password to delete this expense:');
    if (!password) return;
    
    const result = await apiCall(`/financials/expenses/${id}`, {
        method: 'DELETE',
        body: JSON.stringify({ password: password })
    });
    
    if (result?.error) {
        alert('Error: ' + result.error);
    } else {
        alert('Expense deleted successfully!');
        renderExpensesContent();
    }
};

// ========== FINANCIALS SECTION ==========
currentFinancialView = 'summary';

async function renderFinancials() {
    const content = document.getElementById('content');
    
    if (!content) {
        return;
    }
    
    content.innerHTML = `
        <div style="display: flex; gap: 10px; margin-bottom: 20px; border-bottom: 1px solid #e0e0e0; padding-bottom: 10px;">
            <button class="btn-add financial-tab ${currentFinancialView === 'summary' ? 'active' : ''}" data-view="summary" style="background: ${currentFinancialView === 'summary' ? '#4a90d9' : '#95a5a6'};">Summary</button>
            <button class="btn-add financial-tab ${currentFinancialView === 'expenses' ? 'active' : ''}" data-view="expenses" style="background: ${currentFinancialView === 'expenses' ? '#4a90d9' : '#95a5a6'};">Expenses</button>
            <button class="btn-add financial-tab ${currentFinancialView === 'tenantlist' ? 'active' : ''}" data-view="tenantlist" style="background: ${currentFinancialView === 'tenantlist' ? '#4a90d9' : '#95a5a6'};">Tenant List</button>
        </div>
        <div id="financialContent" style="min-height: 400px;">Loading...</div>
    `;
    
    document.querySelectorAll('.financial-tab').forEach(btn => {
        btn.onclick = () => {
            currentFinancialView = btn.getAttribute('data-view');
            renderFinancials();
        };
    });
    
    if (currentFinancialView === 'summary') {
        await renderSummaryContent();
    } else if (currentFinancialView === 'expenses') {
        await renderExpensesContent();
    } else if (currentFinancialView === 'tenantlist') {
        await renderTenantListContent();
    }
}

// ========== RENDER SUMMARY CONTENT ==========
// ========== RENDER SUMMARY CONTENT ==========
async function renderSummaryContent() {
    const container = document.getElementById('financialContent');
    if (!container) return;
    
    container.innerHTML = '<div class="loading">Loading summary...</div>';
    
    try {
        const filterData = await apiCall('/financials/filters/data');
        const properties = filterData?.properties || [];
        
        const today = new Date();
        const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const defaultMonth = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}`;
        
        container.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 8px;">
                <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                    <select id="filterPropertySummary" class="filter-input" style="padding:6px 10px; font-size:13px;">
                        <option value="">All Properties</option>
                        ${properties.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}
                    </select>
                    <input type="month" id="filterMonthSummary" class="filter-input" value="${defaultMonth}" style="padding:6px 10px; font-size:13px;">
                    <button class="btn-add" id="applyFilterSummary" style="padding:6px 14px; font-size:13px;">Apply Filter</button>
                    <button class="btn-add" id="addSummaryBtn" style="background: #5cb85c; padding:6px 14px; font-size:13px;">+ Add Summary</button>
                </div>
                <div style="display: flex; gap: 8px;">
                    <button class="btn-add" id="downloadSummaryCSV" style="background: #3498db; padding:6px 14px; font-size:13px;">📊 CSV</button>
                    <button class="btn-add" id="downloadSummaryPDF" style="background: #e74c3c; padding:6px 14px; font-size:13px;">📄 PDF</button>
                </div>
            </div>
            <div id="summariesList" class="loading">Loading summaries...</div>
        `;
        
        document.getElementById('applyFilterSummary').onclick = () => loadSummaries();
        document.getElementById('addSummaryBtn').onclick = () => showAddSummaryModal(properties);
        document.getElementById('downloadSummaryCSV').onclick = () => downloadSummariesCSV();
        document.getElementById('downloadSummaryPDF').onclick = () => downloadSummariesPDF();
        
        await loadSummaries();
        
        async function loadSummaries() {
            const propertyId = document.getElementById('filterPropertySummary').value;
            const month = document.getElementById('filterMonthSummary').value;
            
            let url = '/financials/summaries';
            if (propertyId) url += `?property_id=${propertyId}`;
            if (month) url += `${propertyId ? '&' : '?'}month=${month}`;
            
            const summaries = await apiCall(url);
            const summariesDiv = document.getElementById('summariesList');
            
            if (!summaries || summaries.length === 0) {
                summariesDiv.innerHTML = '<div class="empty-state">No summaries found. Click "+ Add Summary" to create one.</div>';
                return;
            }
            
            let html = '';
            for (const summary of summaries) {
                const monthStr = new Date(summary.month_year).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
                const companyName = localStorage.getItem('companyName') || 'Rental Management System';
                
                html += `
                    <div class="summary-container" style="margin-bottom:20px; background:white; border:1px solid #e0e0e0; border-radius:4px; padding:16px 20px;">
                        <!-- Header -->
                        <div class="summary-header">
                            <div class="month-year">${escapeHtml(monthStr)}</div>
                            <div class="attention"><strong>ATTENTION:</strong> ${escapeHtml(summary.landlord_name || '-')}</div>
                            <div class="property-name">${escapeHtml(summary.property_name || '-')}</div>
                        </div>
                        
                        <!-- Rent Received Table -->
                        <div class="summary-table-wrapper">
                            <table>
                                <thead>
                                    <tr><th>HSE NO.</th><th>Rent Received</th></tr>
                                </thead>
                                <tbody>
                                    ${summary.rooms && summary.rooms.map(room => `
                                        <tr>
                                            <td>${escapeHtml(room.house_no)}</td>
                                            <td>${room.status === 'VACANT' ? 'VACANT' : (room.status === 'N.P' ? 'N.P' : `KES ${formatNumber(room.amount)}`)}</td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                        
                        <!-- Collections Totals -->
                        <div class="totals-section">
                            <div class="totals-row"><span class="label">COLLECTIONS AT THE OFFICE:</span><span class="value">KES ${formatNumber(summary.collections_office)}</span></div>
                            <div class="totals-row"><span class="label">COLLECTIONS BY LANDLORD:</span><span class="value">KES ${formatNumber(summary.collections_landlord)}</span></div>
                            <div class="totals-row total"><span class="label">TOTAL COLLECTIONS:</span><span class="value">KES ${formatNumber(summary.total_collections)}</span></div>
                        </div>
                        
                        <!-- Expenses Section -->
                        <div class="expenses-section">
                            <div class="section-title">EXPENSES</div>
                            <div class="expenses-table-wrapper">
                                <table>
                                    <thead><tr><th>Expense Type</th><th>Amount</th></tr></thead>
                                    <tbody>
                                        ${summary.expenses && summary.expenses.map(exp => `
                                            <tr><td>${escapeHtml(exp.category)}</td><td>KES ${formatNumber(exp.amount)}</td></tr>
                                        `).join('')}
                                        ${(!summary.expenses || summary.expenses.length === 0) ? '<tr><td colspan="2" style="text-align:center; color:#999;">No expenses recorded</td></tr>' : ''}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                        
                        <!-- Deductions & Net -->
                        <div class="totals-section">
                            <div class="totals-row"><span class="label">TOTAL EXPENSES:</span><span class="value">KES ${formatNumber(summary.total_expenses)}</span></div>
                            <div class="totals-row"><span class="label">COMMISSION PAYABLE:</span><span class="value">KES ${formatNumber(summary.commission_payable)}</span></div>
                            <div class="totals-row"><span class="label">TOTAL DEDUCTIONS:</span><span class="value">KES ${formatNumber(summary.total_deductions)}</span></div>
                            <div class="totals-row total"><span class="label">NET RENT:</span><span class="value">KES ${formatNumber(summary.net_rent)}</span></div>
                            <div class="totals-row total"><span class="label">TOTAL NET RENT:</span><span class="value">KES ${formatNumber(summary.total_net_rent)}</span></div>
                        </div>
                        
                        <!-- Footer -->
                        <div class="summary-footer">
                            <div class="signature-item">
                                <div class="label">DEPOSITED ON</div>
                                <div>${summary.deposited_date ? formatDate(summary.deposited_date) : '-'}</div>
                            </div>
                            <div class="signature-item">
                                <div class="label">PROPERTY MANAGER</div>
                                <div class="line"></div>
                            </div>
                            <div class="signature-item">
                                <div class="label">LANDLORD</div>
                                <div class="line"></div>
                            </div>
                        </div>
                        
                        <!-- Edit/Delete Buttons -->
                        <div style="margin-top:12px; display:flex; gap:8px; justify-content:flex-end; border-top:1px solid #eee; padding-top:10px;">
                            <button class="btn-edit" onclick="editSummary(${summary.id})" style="padding:4px 12px; font-size:12px;">Edit</button>
                            <button class="btn-danger" onclick="deleteSummary(${summary.id})" style="padding:4px 12px; font-size:12px;">Delete</button>
                        </div>
                    </div>
                `;
            }
            
            summariesDiv.innerHTML = html;
        }
    } catch (error) {
        container.innerHTML = '<div class="empty-state">Error loading summary. Please try again.</div>';
    }
}

// ========== ADD SUMMARY MODAL ==========
async function showAddSummaryModal(properties) {
    const propertyOptions = properties.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
    
    const today = new Date();
    const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const defaultMonth = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}`;
    
    const modalHtml = `<div class="modal-content" style="max-width:500px;">
        <h3>Generate Financial Summary</h3>
        <label>Select Property</label>
        <select id="summaryPropertyId">${propertyOptions}</select>
        <label>Month (Previous Month)</label>
        <input type="month" id="summaryMonth" value="${defaultMonth}">
        <label>Commission Payable (%)</label>
        <input type="number" id="summaryCommission" step="0.01" placeholder="Enter commission percentage">
        <label>Collections by Landlord (KES)</label>
        <input type="number" id="summaryLandlordCollection" step="0.01" value="0">
        <label>Admin Password</label>
        <input type="password" id="adminPassword" placeholder="Enter your password">
        <p style="margin-top:10px; font-size:12px; color:#666;">
            This will generate a summary for the selected month using:
            - Rent payments from that month
            - Expenses recorded for that property
        </p>
        <div class="modal-buttons">
            <button class="btn-cancel" id="closeModalBtn">Cancel</button>
            <button class="btn-save" id="generateSummaryBtn">Generate Summary</button>
        </div>
    </div>`;
    
    showModal(modalHtml, null);
    
    setTimeout(() => {
        const generateBtn = document.getElementById('generateSummaryBtn');
        if (generateBtn) {
            generateBtn.onclick = async () => {
                const propertyId = document.getElementById('summaryPropertyId').value;
                const monthYear = document.getElementById('summaryMonth').value;
                const commission = parseFloat(document.getElementById('summaryCommission').value) || 0;
                const landlordCollection = parseFloat(document.getElementById('summaryLandlordCollection').value) || 0;
                const password = document.getElementById('adminPassword').value;
                
                if (!propertyId || !monthYear || !password) {
                    alert('Please fill all required fields');
                    return;
                }
                
                generateBtn.disabled = true;
                generateBtn.textContent = 'Generating...';
                
                const result = await apiCall('/financials/summaries/generate', {
                    method: 'POST',
                    body: JSON.stringify({
                        property_id: parseInt(propertyId),
                        month_year: monthYear,
                        commission_payable: commission,
                        collections_landlord: landlordCollection,
                        password: password
                    })
                });
                
                if (result?.error) {
                    alert('Error: ' + result.error);
                } else {
                    alert('Summary generated successfully!');
                    document.querySelector('.modal')?.remove();
                    renderSummaryContent();
                }
                
                generateBtn.disabled = false;
                generateBtn.textContent = 'Generate Summary';
            };
        }
    }, 100);
}

window.editSummary = async (id) => {
    const summary = await apiCall(`/financials/summaries/${id}`);
    if (!summary) return;
    
    let roomsHtml = '';
    if (summary.rooms) {
        summary.rooms.forEach(room => {
            roomsHtml += `
                <div class="edit-room-row" style="display:flex; gap:10px; margin-bottom:8px; align-items:center;">
                    <input type="text" value="${escapeHtml(room.house_no)}" readonly style="background:#f0f0f0; width:100px; padding:6px;">
                    <select class="room-status" style="padding:6px;">
                        <option value="VACANT" ${room.status === 'VACANT' ? 'selected' : ''}>VACANT</option>
                        <option value="N.P" ${room.status === 'N.P' ? 'selected' : ''}>N.P</option>
                        <option value="PAID" ${room.status === 'PAID' ? 'selected' : ''}>PAID</option>
                    </select>
                    <input type="number" class="room-amount" value="${room.amount}" step="0.01" placeholder="Amount" style="padding:6px; width:120px;">
                </div>
            `;
        });
    }
    
    let expensesHtml = '';
    if (summary.expenses) {
        summary.expenses.forEach(exp => {
            expensesHtml += `
                <div class="edit-expense-row" style="display:flex; gap:10px; margin-bottom:8px; align-items:center;">
                    <input type="text" class="expense-category" value="${escapeHtml(exp.category)}" style="flex:2; padding:6px;">
                    <input type="number" class="expense-amount" value="${exp.amount}" step="0.01" style="flex:1; padding:6px;">
                    <button class="btn-danger remove-expense-btn" style="padding:2px 8px;">✖</button>
                </div>
            `;
        });
    }
    
    const modalHtml = `<div class="modal-content edit-summary-modal" style="max-width:700px; max-height:80vh; overflow-y:auto;">
        <h3>Edit Summary</h3>
        <label>Commission Payable (%)</label>
        <input type="number" id="editCommission" value="${summary.commission_payable}" step="0.01">
        <label>Collections by Landlord (KES)</label>
        <input type="number" id="editLandlordCollection" value="${summary.collections_landlord}" step="0.01">
        <label>Deposited Date</label>
        <input type="date" id="editDepositedDate" value="${summary.deposited_date ? summary.deposited_date.split('T')[0] : ''}">
        <label>Notes</label>
        <textarea id="editNotes" rows="2">${summary.notes || ''}</textarea>
        
        <h4>Rent Received (Rooms)</h4>
        <div id="editRoomsContainer">${roomsHtml}</div>
        
        <h4>Expenses</h4>
        <div id="editExpensesContainer">${expensesHtml}</div>
        <button class="btn-add" id="addExpenseRowBtn" style="margin-top:10px;">+ Add Expense</button>
        
        <label>Admin Password</label>
        <input type="password" id="adminPassword" placeholder="Enter your password">
        
        <div class="modal-buttons">
            <button class="btn-cancel" id="closeModalBtn">Cancel</button>
            <button class="btn-save" id="saveEditSummaryBtn">Save Changes</button>
        </div>
    </div>`;
    
    showModal(modalHtml, null);
    
    setTimeout(() => {
        document.getElementById('addExpenseRowBtn').onclick = () => {
            const container = document.getElementById('editExpensesContainer');
            const newRow = document.createElement('div');
            newRow.className = 'edit-expense-row';
            newRow.style.cssText = 'display:flex; gap:10px; margin-bottom:8px;';
            newRow.innerHTML = `
                <input type="text" class="expense-category" placeholder="Category" style="flex:2; padding:6px;">
                <input type="number" class="expense-amount" placeholder="Amount" step="0.01" style="flex:1; padding:6px;">
                <button class="btn-danger remove-expense-btn" style="padding:2px 8px;">✖</button>
            `;
            container.appendChild(newRow);
            attachRemoveEvents();
        };
        
        function attachRemoveEvents() {
            document.querySelectorAll('.remove-expense-btn').forEach(btn => {
                btn.onclick = () => btn.closest('.edit-expense-row')?.remove();
            });
        }
        attachRemoveEvents();
        
        const saveBtn = document.getElementById('saveEditSummaryBtn');
        if (saveBtn) {
            saveBtn.onclick = async () => {
                const commission = parseFloat(document.getElementById('editCommission').value) || 0;
                const landlordCollection = parseFloat(document.getElementById('editLandlordCollection').value) || 0;
                const depositedDate = document.getElementById('editDepositedDate').value;
                const notes = document.getElementById('editNotes').value;
                const password = document.getElementById('adminPassword').value;
                
                if (!password) {
                    alert('Please enter your admin password');
                    return;
                }
                
                const roomRows = document.querySelectorAll('.edit-room-row');
                const rooms = [];
                roomRows.forEach(row => {
                    const houseNo = row.querySelector('input[readonly]')?.value;
                    const status = row.querySelector('.room-status')?.value;
                    const amount = parseFloat(row.querySelector('.room-amount')?.value) || 0;
                    if (houseNo) {
                        rooms.push({ house_no: houseNo, status, amount });
                    }
                });
                
                const expenseRows = document.querySelectorAll('.edit-expense-row');
                const expenses = [];
                expenseRows.forEach(row => {
                    const category = row.querySelector('.expense-category')?.value;
                    const amount = parseFloat(row.querySelector('.expense-amount')?.value) || 0;
                    if (category && category.trim() && amount > 0) {
                        expenses.push({ category: category.trim(), amount });
                    }
                });
                
                const result = await apiCall(`/financials/summaries/${id}`, {
                    method: 'PUT',
                    body: JSON.stringify({
                        commission_payable: commission,
                        collections_landlord: landlordCollection,
                        deposited_date: depositedDate,
                        notes: notes,
                        rooms: rooms,
                        expenses: expenses,
                        password: password
                    })
                });
                
                if (result?.error) {
                    alert('Error: ' + result.error);
                } else {
                    alert('Summary updated successfully!');
                    document.querySelector('.modal')?.remove();
                    renderSummaryContent();
                }
            };
        }
    }, 100);
};

window.deleteSummary = async (id) => {
    const password = prompt('Enter admin password to delete this summary:');
    if (!password) return;
    
    const result = await apiCall(`/financials/summaries/${id}`, {
        method: 'DELETE',
        body: JSON.stringify({ password: password })
    });
    
    if (result?.error) {
        alert('Error: ' + result.error);
    } else {
        alert('Summary deleted successfully!');
        renderSummaryContent();
    }
};

// Download Summaries CSV - One Summary at a Time
async function downloadSummariesCSV() {
    const summaries = await apiCall('/financials/summaries');
    if (!summaries || summaries.length === 0) {
        alert('No summaries to download');
        return;
    }
    
    // Ask user which summary to download
    const selectedIndex = await showSummarySelectionModal(summaries);
    if (selectedIndex === null) return;
    
    const s = summaries[selectedIndex];
    const monthStr = new Date(s.month_year).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    
    let csv = 'Property,Manager,Month,Collections Office,Collections Landlord,Total Collections,Total Expenses,Commission,Taxable Value,Net Rent\n';
    csv += `"${s.property_name}","${s.landlord_name || ''}","${monthStr}",${s.collections_office},${s.collections_landlord},${s.total_collections},${s.total_expenses},${s.commission_payable},${s.total_deductions},${s.net_rent}\n`;
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Financial_Summary_${s.property_name}_${monthStr.replace(/\s/g, '_')}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Download Summaries PDF - One Summary Per Page
async function downloadSummariesPDF() {
    const summaries = await apiCall('/financials/summaries');
    if (!summaries || summaries.length === 0) {
        alert('No summaries to download');
        return;
    }
    
    // Ask user which summary to download
    const selectedIndex = await showSummarySelectionModal(summaries);
    if (selectedIndex === null) return;
    
    const summary = summaries[selectedIndex];
    const monthStr = new Date(summary.month_year).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    const companyName = localStorage.getItem('companyName') || 'Rental Management System';
    
    let html = `<!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>Financial Summary - ${summary.property_name}</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 40px; }
            .summary-page { max-width: 800px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; }
            .header { text-align: center; margin-bottom: 30px; }
            .header .company { font-size: 22px; font-weight: bold; color: #1e3a5f; }
            .header .month { font-size: 16px; color: #666; margin-top: 5px; }
            .header .attention { font-size: 14px; color: #333; margin-top: 5px; }
            .property-info { margin-bottom: 20px; padding: 10px; background: #f8f8f8; border-radius: 4px; }
            .property-info p { margin: 5px 0; }
            table { width: 100%; border-collapse: collapse; margin: 15px 0; }
            th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
            th { background: #f0f0f0; font-weight: bold; }
            .totals { margin: 15px 0; padding: 10px; background: #f8f8f8; border-radius: 4px; }
            .totals .row { display: flex; justify-content: space-between; padding: 5px 0; }
            .totals .row.total { font-weight: bold; border-top: 1px solid #ddd; margin-top: 5px; padding-top: 5px; }
            .footer { margin-top: 30px; padding-top: 15px; border-top: 1px solid #ddd; display: flex; justify-content: space-between; }
            .footer .signature { text-align: center; }
            .footer .signature .line { width: 200px; border-bottom: 1px solid #333; margin-top: 30px; }
            .seal-text { text-align: center; font-size: 10px; color: #888; margin-top: 20px; }
        </style>
    </head>
    <body>
        <div class="summary-page">
            <div class="header">
                <div class="company">${escapeHtml(companyName)}</div>
                <div class="month">${monthStr}</div>
                <div class="attention"><strong>ATTENTION:</strong> ${escapeHtml(summary.landlord_name || '-')}</div>
                <div class="property"><strong>Property:</strong> ${escapeHtml(summary.property_name || '-')}</div>
            </div>
            
            <h4>RENT RECEIVED</h4>
            <table>
                <thead><tr><th>HSE NO.</th><th>Rent Received</th></tr></thead>
                <tbody>
                    ${summary.rooms && summary.rooms.map(room => `
                        <tr>
                            <td>${escapeHtml(room.house_no)}</td>
                            <td>${room.status === 'VACANT' ? 'VACANT' : (room.status === 'N.P' ? 'N.P' : `KES ${formatNumber(room.amount)}`)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            
            <div class="totals">
                <div class="row"><span>COLLECTIONS AT THE OFFICE:</span><span>KES ${formatNumber(summary.collections_office)}</span></div>
                <div class="row"><span>COLLECTIONS BY LANDLORD:</span><span>KES ${formatNumber(summary.collections_landlord)}</span></div>
                <div class="row total"><span>TOTAL COLLECTIONS:</span><span>KES ${formatNumber(summary.total_collections)}</span></div>
            </div>
            
            <h4>EXPENSES</h4>
            <table>
                <thead><tr><th>Expense Type</th><th>Amount</th></tr></thead>
                <tbody>
                    ${summary.expenses && summary.expenses.map(exp => `
                        <tr><td>${escapeHtml(exp.category)}</td><td>KES ${formatNumber(exp.amount)}</td></tr>
                    `).join('')}
                    ${(!summary.expenses || summary.expenses.length === 0) ? '<tr><td colspan="2">No expenses recorded</td></tr>' : ''}
                </tbody>
            </table>
            
            <div class="totals">
                <div class="row"><span>TOTAL EXPENSES:</span><span>KES ${formatNumber(summary.total_expenses)}</span></div>
                <div class="row"><span>COMMISSION PAYABLE:</span><span>KES ${formatNumber(summary.commission_payable)}</span></div>
                <div class="row"><span>TOTAL DEDUCTIONS:</span><span>KES ${formatNumber(summary.total_deductions)}</span></div>
                <div class="row total"><span>NET RENT:</span><span>KES ${formatNumber(summary.net_rent)}</span></div>
                <div class="row total"><span>TOTAL NET RENT:</span><span>KES ${formatNumber(summary.total_net_rent)}</span></div>
            </div>
            
            <div class="footer">
                <div class="signature">
                    <div>DEPOSITED ON: ${summary.deposited_date ? formatDate(summary.deposited_date) : '-'}</div>
                </div>
                <div class="signature">
                    <div>PROPERTY MANAGER</div>
                    <div class="line"></div>
                </div>
                <div class="signature">
                    <div>LANDLORD</div>
                    <div class="line"></div>
                </div>
            </div>
            
            <div class="seal-text">This summary was created by computer and is valid without signature and seal.</div>
        </div>
    </body>
    </html>`;
    
    // Create download
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Financial_Summary_${summary.property_name}_${monthStr.replace(/\s/g, '_')}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Show Summary Selection Modal
function showSummarySelectionModal(summaries) {
    return new Promise((resolve) => {
        let optionsHtml = summaries.map((s, i) => {
            const monthStr = new Date(s.month_year).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
            return `<option value="${i}">${escapeHtml(s.property_name)} - ${monthStr}</option>`;
        }).join('');
        
        const modalHtml = `
            <div class="modal-content" style="max-width:400px;">
                <h3>Select Summary to Download</h3>
                <label>Choose a summary:</label>
                <select id="summarySelect" style="width:100%; padding:10px; margin:10px 0;">${optionsHtml}</select>
                <div class="modal-buttons">
                    <button class="btn-cancel" id="closeModalBtn">Cancel</button>
                    <button class="btn-save" id="confirmDownloadBtn">Download</button>
                </div>
            </div>
        `;
        
        showModal(modalHtml, null);
        
        setTimeout(() => {
            document.getElementById('confirmDownloadBtn').onclick = () => {
                const selected = parseInt(document.getElementById('summarySelect').value);
                const modal = document.querySelector('.modal');
                if (modal) modal.remove();
                resolve(selected);
            };
            document.getElementById('closeModalBtn').onclick = () => {
                const modal = document.querySelector('.modal');
                if (modal) modal.remove();
                resolve(null);
            };
        }, 100);
    });
}

// ========== RENDER EXPENSES CONTENT ==========
async function renderExpensesContent() {
    const container = document.getElementById('financialContent');
    if (!container) {
        return;
    }
    
    container.innerHTML = '<div class="loading">Loading expenses...</div>';
    
    try {
        const properties = await apiCall('/properties');
        
        container.innerHTML = `
            <div style="display: flex; justify-content: flex-end; margin-bottom: 15px;">
                <button class="btn-add" id="addExpenseBtnFinancial">+ Add Expense</button>
            </div>
            <div class="filters">
                <input type="text" id="searchExpenseFinancial" class="filter-input" placeholder="Search...">
                <select id="filterPropertyExpenseFinancial" class="filter-input">
                    <option value="">All Properties</option>
                    ${properties ? properties.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('') : ''}
                </select>
                <select id="filterStatusExpenseFinancial" class="filter-input">
                    <option value="">All Status</option>
                    <option value="finished">Finished</option>
                    <option value="in_progress">In Progress</option>
                </select>
                <input type="date" id="filterDateFromExpenseFinancial" class="filter-input" placeholder="From Date">
                <input type="date" id="filterDateToExpenseFinancial" class="filter-input" placeholder="To Date">
            </div>
            <div id="expensesListFinancial" class="loading">Loading expenses...</div>
        `;
        
        const addExpenseBtn = document.getElementById('addExpenseBtnFinancial');
        if (addExpenseBtn) {
            addExpenseBtn.onclick = function() {
                showAddExpenseModal();
            };
        }
        
        await loadExpensesListFinancial();
        
        const filterIds = ['searchExpenseFinancial', 'filterPropertyExpenseFinancial', 'filterStatusExpenseFinancial', 'filterDateFromExpenseFinancial', 'filterDateToExpenseFinancial'];
        filterIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('input', () => loadExpensesListFinancial());
                el.addEventListener('change', () => loadExpensesListFinancial());
            }
        });
        
    } catch (error) {
        container.innerHTML = '<div class="empty-state">Error loading expenses: ' + error.message + '</div>';
    }
    
    async function loadExpensesListFinancial() {
        try {
            const search = document.getElementById('searchExpenseFinancial')?.value || '';
            const propertyId = document.getElementById('filterPropertyExpenseFinancial')?.value || '';
            const status = document.getElementById('filterStatusExpenseFinancial')?.value || '';
            const dateFrom = document.getElementById('filterDateFromExpenseFinancial')?.value || '';
            const dateTo = document.getElementById('filterDateToExpenseFinancial')?.value || '';
            
            let url = '/financials/expenses?';
            if (search) url += `search=${encodeURIComponent(search)}&`;
            if (propertyId) url += `property_id=${propertyId}&`;
            if (status) url += `status=${status}&`;
            if (dateFrom) url += `start_date=${dateFrom}&`;
            if (dateTo) url += `end_date=${dateTo}&`;
            
            const expenses = await apiCall(url);
            const expensesDiv = document.getElementById('expensesListFinancial');
            
            if (!expenses || expenses.length === 0) {
                expensesDiv.innerHTML = '<div class="empty-state">No expenses found.</div>';
                return;
            }
            
            let html = `<div class="table-wrapper"><table style="width:100%;"><thead>
                <tr><th>Date</th><th>Property</th><th>Unit</th><th>Category</th><th>Amount</th><th>Status</th><th>Actions</th></tr>
            </thead><tbody>`;
            
            expenses.forEach(e => {
                const statusClass = e.status === 'finished' ? 'status-active' : 'status-partial';
                const statusText = e.status === 'finished' ? 'Finished' : 'In Progress';
                html += `<tr>
                    <td>${formatDate(e.expense_date)}</td>
                    <td>${escapeHtml(e.property_name)}</td>
                    <td>${escapeHtml(e.unit_name) || '-'}</td>
                    <td>${escapeHtml(e.category)}</td>
                    <td>KES ${formatNumber(e.amount)}</td>
                    <td><span class="${statusClass}">${statusText}</span></td>
                    <td class="action-buttons">
                        <button class="btn-edit" onclick="window.editExpense(${e.id})">Edit</button>
                        <button class="btn-danger" onclick="window.deleteExpense(${e.id})">Delete</button>
                    </td>
                </tr>`;
            });
            
            html += `</tbody></table></div>`;
            expensesDiv.innerHTML = html;
        } catch (error) {
        }
    }
}


// ========== RENDER TENANT LIST CONTENT ==========
async function renderTenantListContent() {
    const container = document.getElementById('financialContent');
    if (!container) {
        return;
    }
    
    container.innerHTML = '<div class="loading">Loading tenant list...</div>';
    
    try {
        // Get filter data
        const filterData = await apiCall('/financials/filters/data');
        
        const properties = filterData?.properties || [];
        const months = filterData?.months || [];
        
        const today = new Date();
        const currentMonth = today.getMonth() + 1;
        const currentYear = today.getFullYear();
        
        // Build the UI with Download buttons
        container.innerHTML = `
            <div class="filters" style="margin-bottom:20px; display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
                <select id="reportPropertyIdFinancial" class="filter-input" style="flex:1; min-width:150px;">
                    <option value="">All Properties</option>
                    ${properties.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}
                </select>
                <select id="reportMonthFinancial" class="filter-input" style="flex:1; min-width:150px;">
                    ${months.map(m => `<option value="${m.year}-${m.month}" ${m.year === currentYear && m.month === currentMonth ? 'selected' : ''}>${m.display}</option>`).join('')}
                </select>
                <button class="btn-add" id="generateReportBtnFinancial">Generate Report</button>
                <button class="btn-add" id="downloadCSVReportBtnFinancial" style="background:#5cb85c;">📊 Download CSV</button>
                <button class="btn-add" id="downloadPDFReportBtnFinancial" style="background:#e74c3c;">📄 Download PDF</button>
            </div>
            <div id="tenantReportContentFinancial" class="loading">Select property and month, then click Generate Report</div>
        `;
        
        // Attach button events
        const generateBtn = document.getElementById('generateReportBtnFinancial');
        if (generateBtn) {
            generateBtn.onclick = function() {
                loadTenantReportFinancial();
            };
        }
        
        const downloadCSVBtn = document.getElementById('downloadCSVReportBtnFinancial');
        if (downloadCSVBtn) {
            downloadCSVBtn.onclick = function() {
                downloadTenantReportCSVFinancial();
            };
        }
        
        const downloadPDFBtn = document.getElementById('downloadPDFReportBtnFinancial');
        if (downloadPDFBtn) {
            downloadPDFBtn.onclick = function() {
                downloadTenantReportPDFFinancial();
            };
        }
        
    } catch (error) {
        container.innerHTML = '<div class="empty-state">Error loading tenant list: ' + error.message + '</div>';
    }
}

// ========== LOAD TENANT REPORT ==========
async function loadTenantReportFinancial() {
    const propertyId = document.getElementById('reportPropertyIdFinancial')?.value || '';
    const monthYear = document.getElementById('reportMonthFinancial')?.value || '';
    
    if (!monthYear) {
        alert('Please select a month');
        return;
    }
    
    const [year, month] = monthYear.split('-');
    
    let url = `/financials/tenant-list?month=${month}&year=${year}`;
    if (propertyId) url += `&property_id=${propertyId}`;
    
    try {
        const data = await apiCall(url);
        const reportDiv = document.getElementById('tenantReportContentFinancial');
        
        if (!data || data.length === 0) {
            reportDiv.innerHTML = '<div class="empty-state">No tenants found for the selected criteria</div>';
            return;
        }
        
        // Process and group data
        const grouped = {};
        data.forEach(item => {
            if (!item.has_tenant) return;
            
            const propertyKey = item.property_id;
            if (!grouped[propertyKey]) {
                grouped[propertyKey] = {
                    property_name: item.property_name,
                    manager_name: item.manager_name,
                    floors: {}
                };
            }
            
            const floorNum = item.floor_number || 0;
            let floorName = 'Ground Floor';
            if (floorNum === 1) floorName = 'First Floor';
            else if (floorNum === 2) floorName = 'Second Floor';
            else if (floorNum === 3) floorName = 'Third Floor';
            else if (floorNum > 0) floorName = `Floor ${floorNum}`;
            
            if (!grouped[propertyKey].floors[floorName]) {
                grouped[propertyKey].floors[floorName] = [];
            }
            
            grouped[propertyKey].floors[floorName].push(item);
        });
        
        // Build HTML
        let html = '';
        for (const propId in grouped) {
            const prop = grouped[propId];
            html += `<div style="margin-bottom:30px; background:white; border-radius:8px; padding:20px; border:1px solid #e0e0e0;">
                <h3>${escapeHtml(prop.manager_name)}</h3>
                <p style="color:#666;">${escapeHtml(prop.property_name)}</p>
            `;
            
            for (const floorName in prop.floors) {
                const tenants = prop.floors[floorName];
                html += `<h4 style="background:#f0f0f0; padding:8px; margin:10px 0;">${floorName}</h4>
                    <div class="table-wrapper">
                        <table style="width:100%; font-size:13px; border-collapse:collapse;">
                            <thead>
                                <tr>
                                    <th style="border:1px solid #ddd; padding:8px;">NAME</th>
                                    <th style="border:1px solid #ddd; padding:8px;">A/C NO</th>
                                    <th style="border:1px solid #ddd; padding:8px;">MOB NO.</th>
                                    <th style="border:1px solid #ddd; padding:8px;">AMNT PAYABLE</th>
                                    <th style="border:1px solid #ddd; padding:8px;">RENT PAYED</th>
                                    <th style="border:1px solid #ddd; padding:8px;">ARREARS</th>
                                    <th style="border:1px solid rgba(235, 243, 243, 0.89); padding:8px;">OVERPAYMENT</th>
                                    <th style="border:1px solid #ddd; padding:8px;">DEP BAL</th>
                                    <th style="border:1px solid #ddd; padding:8px;">PENALTY</th>
                                </tr>
                            </thead>
                            <tbody>`;
                
                // In the table rendering, update to show negative arrears in red
tenants.forEach(t => {
    const arrearsColor = t.arrears > 0 ? '#e74c3c' : '#333';
    const overpaymentColor = t.overpayment > 0 ? '#27ae60' : '#333';
    const depositColor = t.deposit_balance > 0 ? '#e74c3c' : '#333';
    const penaltyColor = t.penalty > 0 ? '#e74c3c' : '#333';
    
    html += `<tr>
        <td style="border:1px solid #ddd; padding:8px;">${escapeHtml(t.first_name || '')} ${escapeHtml(t.last_name || '')}</td>
        <td style="border:1px solid #ddd; padding:8px;">${escapeHtml(t.room_number)}</td>
        <td style="border:1px solid #ddd; padding:8px;">${escapeHtml(t.phone)}</td>
        <td style="border:1px solid #ddd; padding:8px;">KES ${formatNumber(t.rent_payable)}</td>
        <td style="border:1px solid #ddd; padding:8px;">KES ${formatNumber(t.rent_paid)}</td>
        <td style="border:1px solid #ddd; padding:8px; color:${arrearsColor};">KES ${formatNumber(t.arrears)}</td>
        <td style="border:1px solid #ddd; padding:8px; color:${overpaymentColor};">KES ${formatNumber(t.overpayment)}</td>
        <td style="border:1px solid #ddd; padding:8px; color:${depositColor};">KES ${formatNumber(t.deposit_balance)}</td>
        <td style="border:1px solid #ddd; padding:8px; color:${penaltyColor};">KES ${formatNumber(t.penalty)}</td>
    </tr>`;
});
                
                html += `</tbody></table></div>`;
            }
            html += `</div>`;
        }
        
        reportDiv.innerHTML = html;
        
        // Save data for download
        window.tenantReportData = data;
        window.tenantReportGrouped = grouped;
        
    } catch (error) {
        document.getElementById('tenantReportContentFinancial').innerHTML = '<div class="empty-state">Error loading report: ' + error.message + '</div>';
    }
    // ========== DOWNLOAD TENANT LIST CSV ==========
async function downloadTenantReportCSVFinancial() {
    if (!window.tenantReportData) {
        alert('Please generate a report first');
        return;
    }
    
    const grouped = window.tenantReportGrouped;
    
    // Ask user for file name
    const fileName = prompt('Enter file name:', 'tenant_list');
    if (fileName === null) return;
    
    let csv = 'Property,Manager,Floor,Name,Account No,Phone No,Rent Payable,Paid,Arrears,Overpayment,Deposit Balance,Penalty\n';
    
    for (const propId in grouped) {
        const prop = grouped[propId];
        for (const floorName in prop.floors) {
            for (const t of prop.floors[floorName]) {
                csv += `"${prop.property_name}","${prop.manager_name}","${floorName}","${t.first_name || ''} ${t.last_name || ''}","${t.room_number}","${t.phone}",${t.rent_payable},${t.rent_paid},${t.arrears},${t.overpayment},${t.deposit_balance},${t.penalty}\n`;
            }
        }
    }
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
// ========== DOWNLOAD TENANT LIST PDF ==========
async function downloadTenantReportPDFFinancial() {
    if (!window.tenantReportData) {
        alert('Please generate a report first');
        return;
    }
    
    const grouped = window.tenantReportGrouped;
    
    const fileName = prompt('Enter file name:', 'tenant_list');
    if (fileName === null) return;
    
    let html = `<!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>Tenant List Report</title>
        <style>
            body{font-family:Arial;margin:20px;}
            table{width:100%;border-collapse:collapse;margin:10px 0;font-size:12px;}
            th,td{border:1px solid #ddd;padding:6px;text-align:left;}
            th{background:#f5f5f5;}
            .property-section{margin-bottom:30px;page-break-inside:avoid;}
            .floor-title{background:#e0e0e0;padding:5px;margin-top:15px;}
            .red-text{color:#e74c3c;}
            .green-text{color:#27ae60;}
        </style>
    </head>
    <body>`;
    
    html += `<h2>Tenant List Report</h2>`;
    html += `<p>Generated: ${new Date().toLocaleString()}</p>`;
    
    for (const propId in grouped) {
        const prop = grouped[propId];
        html += `<div class="property-section">
            <h3>${escapeHtml(prop.manager_name)}</h3>
            <p>${escapeHtml(prop.property_name)}</p>`;
        
        for (const floorName in prop.floors) {
            html += `<div class="floor-title"><strong>${floorName}</strong></div>`;
            html += `<table>
                <thead>
                    <tr>
                        <th>NAME</th>
                        <th>A/C NO</th>
                        <th>MOB NO.</th>
                        <th>AMNT PAYA</th>
                        <th>RENT</th>
                        <th>ARREARS</th>
                        <th>OVERPAYMENT</th>
                        <th>DEP BAL</th>
                        <th>PENALTY</th>
                    </tr>
                </thead>
                <tbody>`;
            
            prop.floors[floorName].forEach(t => {
                const arrearsColor = t.arrears > 0 ? 'red-text' : '';
                const overpaymentColor = t.overpayment > 0 ? 'green-text' : '';
                const depositColor = t.deposit_balance > 0 ? 'red-text' : '';
                const penaltyColor = t.penalty > 0 ? 'red-text' : '';
                
                html += `<tr>
                    <td>${escapeHtml(t.first_name || '')} ${escapeHtml(t.last_name || '')}</td>
                    <td>${t.room_number}</td>
                    <td>${t.phone}</td>
                    <td>KES ${formatNumber(t.rent_payable)}</td>
                    <td>KES ${formatNumber(t.rent_paid)}</td>
                    <td class="${arrearsColor}">KES ${formatNumber(t.arrears)}</td>
                    <td class="${overpaymentColor}">KES ${formatNumber(t.overpayment)}</td>
                    <td class="${depositColor}">KES ${formatNumber(t.deposit_balance)}</td>
                    <td class="${penaltyColor}">KES ${formatNumber(t.penalty)}</td>
                </tr>`;
            });
            
            html += `</tbody></table>`;
        }
        html += `</div>`;
    }
    
    html += `</body></html>`;
    
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
}

// ========== AUTO GENERATE TENANT LIST WITH PASSWORD ==========
document.getElementById('autoGenTlBtn')?.addEventListener('click', () => {
    showPasswordModal('Auto Generate Tenant List', 'Enter your password to generate the tenant list for the current month.', (password) => {
        alert('Generating tenant list with password: ' + (password ? '✅' : '❌'));
        // Full implementation will call the API
    });
});

// ========== INITIALIZATION ==========
if(token){
    renderMainApp(localStorage.getItem('companyName') || 'Rental System');
} else {
    renderAuth();
}