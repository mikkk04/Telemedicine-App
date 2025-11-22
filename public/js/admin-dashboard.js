/* Final Version - Cleaned, Verified, and Themed */
'use strict'; // Added strict mode for better code quality and error prevention

window.addEventListener('DOMContentLoaded', () => {
    const username = localStorage.getItem('telemedicine_user');
    const role = localStorage.getItem('telemedicine_role');

    // Authentication Check
    if (!username || role !== 'Admin') {
        alert('Access denied. Please log in as an Admin.');
        window.location.href = '/'; // Redirect to login
        return; // Stop script execution
    }

    document.getElementById('username-display').textContent = `Welcome, ${username}!`;

    const socket = io();
    const chartInstances = {}; // Store chart instances to destroy before redrawing
    let dataSyncIntervals = []; // Store interval IDs for cleanup
    let calendarInstance = null; // Store FullCalendar instance

    // --- Sidebar Toggle Functionality (Updated for Tailwind) ---
    const sidebar = document.getElementById('sidebar');
    const mainContent = document.getElementById('main-content');
    const sidebarToggle = document.getElementById('sidebar-toggle');

    if (sidebarToggle && sidebar && mainContent) {
        sidebarToggle.addEventListener('click', () => {
            sidebar.classList.toggle('-translate-x-full');
            sidebar.classList.toggle('translate-x-0');
            // Optional: Add overlay for mobile view
        });
    }

    // --- Close sidebar on link/button click (for mobile) ---
    document.querySelectorAll('.sidebar-nav a, #logoutBtn').forEach(element => {
        element.addEventListener('click', () => {
            if (window.innerWidth <= 1024) { // Use lg breakpoint
                sidebar.classList.add('-translate-x-full');
                sidebar.classList.remove('translate-x-0');
            }
        });
    });
    // --- End Sidebar Logic ---

    // --- Chart.js Global Settings ---
    Chart.defaults.color = document.body.classList.contains('light-mode') ? '#4a5568' : '#a0a0a0'; // text-secondary
    Chart.defaults.borderColor = document.body.classList.contains('light-mode') ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.1)'; // border-color

    // --- Custom 3D Bar Chart Plugin ---
    const bar3DPlugin = {
        id: 'customBar3D',
        beforeDraw(chart, args, options) {
            const ctx = chart.ctx;
            const meta = chart.getDatasetMeta(0);
            const data = meta.data;

            if (!data || data.length === 0) return;

            // Define colors dynamically based on theme if needed, or use options
            const baseColor = options.baseColor || 'rgba(74, 144, 226, 1)'; // Example default
            const topColor = options.topColor || 'rgba(255, 255, 255, 0.4)';
            const sideColor = options.sideColor || 'rgba(0, 0, 0, 0.2)';
            const depth = options.depth || 10;

            data.forEach((bar) => {
                const { x, y, base, width } = bar;
                const bottom = base;
                const top = y;
                const right = x + width / 2;
                const left = x - width / 2;

                // Simple 3D effect (adjust colors and depth as needed)
                // Side face
                ctx.fillStyle = sideColor;
                ctx.beginPath();
                ctx.moveTo(right, top);
                ctx.lineTo(right + depth, top - depth);
                ctx.lineTo(right + depth, bottom - depth);
                ctx.lineTo(right, bottom);
                ctx.closePath();
                ctx.fill();

                // Top face
                ctx.fillStyle = topColor;
                ctx.beginPath();
                ctx.moveTo(left, top);
                ctx.lineTo(left + depth, top - depth);
                ctx.lineTo(right + depth, top - depth);
                ctx.lineTo(right, top);
                ctx.closePath();
                ctx.fill();

                // Front face (draw last to be on top)
                ctx.fillStyle = baseColor;
                ctx.beginPath();
                ctx.moveTo(left, top);
                ctx.lineTo(right, top);
                ctx.lineTo(right, bottom);
                ctx.lineTo(left, bottom);
                ctx.closePath();
                ctx.fill();
            });
        }
    };
    // --- End Chart Plugin ---


    // --- Data Sync Control ---
    const stopDataSync = () => {
        dataSyncIntervals.forEach(clearInterval);
        dataSyncIntervals = [];
        console.log('Data sync intervals stopped.');
    };

    const startDataSync = () => {
        stopDataSync(); // Ensure no duplicates
        console.log('Starting data sync intervals...');
        // Dashboard Sync (more frequent)
        dataSyncIntervals.push(setInterval(() => {
            const dashboardSection = document.getElementById('dashboard-content');
            if (dashboardSection && !dashboardSection.classList.contains('hidden')) {
                console.log('Auto-syncing dashboard data...');
                socket.emit('admin:get:dashboard-data');
            }
        }, 15000)); // Sync dashboard every 15 seconds

        // User Management Sync (less frequent)
        dataSyncIntervals.push(setInterval(() => {
            const userManagementSection = document.getElementById('user-management-content');
            if (userManagementSection && !userManagementSection.classList.contains('hidden')) {
                console.log('Auto-syncing user lists...');
                requestUserManagementData();
            }
        }, 60000)); // Sync users every 60 seconds

        // Analytics Sync (least frequent)
        dataSyncIntervals.push(setInterval(() => {
            const analyticsSection = document.getElementById('analytics-content');
            if (analyticsSection && !analyticsSection.classList.contains('hidden')) {
                console.log('Auto-syncing analytics data...');
                requestAnalyticsData();
            }
        }, 300000)); // Sync analytics every 5 minutes
    };
    // --- End Data Sync ---

    // --- Socket.IO Event Listeners ---
    socket.on('connect', () => {
        console.log('Connected to server via Socket.IO');
        socket.emit('user:online', { username }, (response) => {
            if (response.success && response.user.role === 'Admin') {
                console.log('Admin user authenticated successfully.');
                requestInitialData(); // Fetch data after successful authentication
                startDataSync(); // Start periodic data fetching
            } else {
                console.error('Admin authentication failed:', response.message);
                alert('Authentication failed. Please log out and log in again.');
                window.location.href = '/'; // Redirect on failure
            }
        });
    });

    socket.on('disconnect', () => {
        console.warn('Disconnected from server.');
        stopDataSync(); // Stop fetching data on disconnect
        // Optionally show a notification or attempt reconnection UI
    });

    // ⭐ START: Added Listener for Real-time Appointment Updates
    socket.on('appointments:refetch', () => {
        console.log('[Real-time] Received appointments:refetch signal.');
        const activeViewId = document.querySelector('.content-section:not(.hidden)')?.id;

        // Refresh data based on the currently active view
        if (activeViewId === 'dashboard-content') {
            console.log('Dashboard active, refreshing dashboard data...');
            requestDashboardData(); // Refreshes stats, main chart, activity, calendar
        } else if (activeViewId === 'user-management-content') {
            console.log('User Management active, refreshing user lists...');
            requestUserManagementData(); // Refreshes patient and doctor tables
        }
         // Analytics might not need instant refresh on appointment changes,
         // but could be added here if desired.
         // if (activeViewId === 'analytics-content') { requestAnalyticsData(); }
    });
    // ⭐ END: Added Listener

    socket.on('admin:dashboard-data', (data) => {
        console.log('Received dashboard data:', data);
        if (data.success) {
            updateDashboardStats(data.stats);
            renderDashboardMainChart(data.mainDashboardChart);
            renderActivityFeed(data.activityFeed);
             // Assuming calendar data is fetched separately or included here
             // If fetched separately: fetchCalendarData();
             // If included: renderCalendarEvents(data.calendarEvents);
             fetchCalendarData(); // Fetch calendar data after dashboard data arrives
        } else {
            console.error('Failed to load dashboard data:', data.message);
        }
    });

     socket.on('admin:analytics-data:updated', (response) => {
         console.log('Received updated analytics chart data:', response);
         if (response.success) {
             if (response.chart === 'diagnoses') {
                 renderBarChart('topDiagnosesChart', response.chartData, 'Number of Diagnoses', '#3b82f6', 'y');
             } else if (response.chart === 'consultations') {
                 renderLineChart('consultationsChart', response.chartData, 'Consultations Over Time', '#22c55e');
             }
             // Add handlers for other charts if they have filters
         } else {
             console.error(`Failed to update ${response.chart} chart:`, response.message);
         }
     });


    socket.on('admin:analytics-data', (data) => {
        console.log('Received full analytics data:', data);
        if (data.success) {
            renderAnalyticsCharts(data); // Render all analytics charts
        } else {
            console.error('Failed to load analytics data:', data.message);
        }
    });

    socket.on('admin:patients:list', (response) => {
        if (response.success) {
            renderPatients(response.patients);
        } else {
            console.error('Failed to load patient data:', response.message);
        }
    });

    socket.on('admin:doctors:list', (response) => {
        if (response.success) {
            renderDoctors(response.doctors);
        } else {
            console.error('Failed to load doctor data:', response.message);
        }
    });

    socket.on('admin:notification', (notification) => {
        addNotification(notification.message);
    });

    socket.on('admin:stats:updated', (stats) => {
        console.log('Received real-time stat update:', stats);
        updateDashboardStats(stats);
    });

    socket.on('admin:activity:new', (activity) => {
        console.log('Received new activity:', activity);
        prependActivity(activity); // Add to top of feed
        addNotification(activity.message); // Show as notification
    });

    socket.on('admin:user-list:updated', () => {
        console.log('Received user list update signal.');
        // Refresh user lists only if the user management view is currently active
        const userManagementSection = document.getElementById('user-management-content');
        if (userManagementSection && !userManagementSection.classList.contains('hidden')) {
            console.log('User management is active, refreshing user lists.');
            requestUserManagementData();
        }
    });

    // --- Data Fetching Functions ---
    const requestInitialData = () => {
        console.log('Requesting initial data sets...');
        requestDashboardData(); // Includes calendar now
        requestAnalyticsData();
        // User management data is fetched when the view is activated
    };

    const requestDashboardData = () => {
        socket.emit('admin:get:dashboard-data');
         // We also need calendar data for the dashboard view
         fetchCalendarData();
    };

    const requestUserManagementData = () => {
        socket.emit('admin:get:patients');
        socket.emit('admin:get:doctors');
    };

    const requestAnalyticsData = () => {
        console.log('Requesting analytics data from server...');
        socket.emit('admin:get:analytics-data');
    };

     // FIX: Remove the duplicate function declaration here
     // const requestReviewsData = () => { ... };

    // --- UI Update Functions ---
    const updateDashboardStats = (stats) => {
        document.getElementById('consultationsTodayCount').textContent = stats.consultationsToday ?? 0;
        document.getElementById('pendingAppointmentsCount').textContent = stats.pendingAppointments ?? 0;
        document.getElementById('activeDoctorsCount').textContent = stats.activeDoctors ?? 0;
         // Corrected ID for new patients today
        document.getElementById('newPatientsCount').textContent = stats.newPatientsCount ?? 0;
    };

    const renderActivityFeed = (activities) => {
        const feedList = document.getElementById('activity-feed-list');
        if (!feedList) return;
        feedList.innerHTML = ''; // Clear existing
        if (activities && activities.length > 0) {
            activities.forEach(activity => {
                const li = document.createElement('li');
                // Use neumorphic styles defined in CSS
                // li.className = 'p-3 rounded-lg neumorphic-flat mb-3'; // Example class
                li.innerHTML = `
                    <span class="block text-xs text-[var(--text-secondary)] mb-1">${new Date(activity.timestamp).toLocaleString()}</span>
                    ${activity.message}
                `;
                feedList.appendChild(li);
            });
        } else {
            feedList.innerHTML = '<li class="text-center text-[var(--text-secondary)] italic p-4">No recent activity.</li>';
        }
    };

    const prependActivity = (activity) => {
        const feedList = document.getElementById('activity-feed-list');
        if (!feedList) return;
        // Remove placeholder if present
        const placeholder = feedList.querySelector('.italic');
        if (placeholder) placeholder.remove();

        const li = document.createElement('li');
        // li.className = 'p-3 rounded-lg neumorphic-flat mb-3 animate-slide-in'; // Example class
         li.innerHTML = `
             <span class="block text-xs text-[var(--text-secondary)] mb-1">${new Date(activity.timestamp).toLocaleString()}</span>
             ${activity.message}
         `;
        feedList.prepend(li); // Add to the top
         // Optional: Limit the number of items shown
         while (feedList.children.length > 20) { // Keep latest 20 activities
             feedList.removeChild(feedList.lastChild);
         }
    };


    // --- Notification Handling ---
    const notifications = []; // Store recent notifications
    const MAX_NOTIFICATIONS = 50;

    const addNotification = (message) => {
        const list = document.getElementById('notification-list');
        const countBadge = document.getElementById('notification-count');
        if (!list || !countBadge) return;

        // Add to array and trim if exceeds max
        notifications.unshift({ message, timestamp: new Date() });
        if (notifications.length > MAX_NOTIFICATIONS) {
            notifications.pop();
        }

        // Update UI list
        const item = document.createElement('li');
        item.className = 'p-3 text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] border-b border-[var(--border-color)] last:border-b-0 text-sm';
         item.innerHTML = `
            <div>${message}</div>
             <div class="text-xs text-right opacity-70">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
         `;
        list.prepend(item);

         // Trim UI list if needed
         while (list.children.length > MAX_NOTIFICATIONS) {
             list.removeChild(list.lastChild);
         }


        // Update badge count (only if dropdown is hidden)
        const dropdown = document.getElementById('notification-dropdown');
        if (dropdown.classList.contains('hidden')) {
            let count = parseInt(countBadge.textContent, 10);
            count++;
            countBadge.textContent = count;
            countBadge.classList.remove('hidden');
        }
    };

    // Notification Bell Click Handler
     document.getElementById('notification-bell').addEventListener('click', (e) => {
         e.stopPropagation(); // Prevent closing immediately if clicking outside logic is used
        const dropdown = document.getElementById('notification-dropdown');
        const countBadge = document.getElementById('notification-count');
        dropdown.classList.toggle('hidden');
        // Reset count and hide badge when dropdown is opened
        if (!dropdown.classList.contains('hidden')) {
            countBadge.textContent = '0';
            countBadge.classList.add('hidden');
        }
    });

     // Hide notification dropdown if clicking outside
     document.addEventListener('click', (e) => {
         const dropdown = document.getElementById('notification-dropdown');
         const bell = document.getElementById('notification-bell');
         if (dropdown && !dropdown.classList.contains('hidden') && !dropdown.contains(e.target) && e.target !== bell && !bell.contains(e.target)) {
             dropdown.classList.add('hidden');
         }
     });


    // --- Chart Rendering Functions (with no-data handling) ---
    const showNoDataMessage = (canvasId, message = 'No data to display') => {
        // Destroy existing chart instance if it exists
        if (chartInstances[canvasId]) {
            chartInstances[canvasId].destroy();
            delete chartInstances[canvasId];
        }
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        // Clear canvas and draw message
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim(); // Use CSS variable
        ctx.font = '16px Poppins'; // Match body font
        ctx.fillText(message, canvas.width / 2, canvas.height / 2);
        ctx.restore();
    };

    const renderChart = (canvasId, type, data, options, plugins = []) => {
        if (chartInstances[canvasId]) {
            chartInstances[canvasId].destroy(); // Destroy previous instance
        }
        const ctx = document.getElementById(canvasId)?.getContext('2d');
        if (ctx) {
            chartInstances[canvasId] = new Chart(ctx, { type, data, options, plugins });
        } else {
            console.error(`Canvas element with ID "${canvasId}" not found.`);
        }
    };

    // --- Specific Chart Renderers ---
    const renderLineChart = (canvasId, chartData, label, color) => {
        if (!chartData || !chartData.data || chartData.data.length === 0) {
            showNoDataMessage(canvasId); return;
        }
        const ctx = document.getElementById(canvasId).getContext('2d');
        const gradientFill = ctx.createLinearGradient(0, 0, 0, 350);
        gradientFill.addColorStop(0, `${color}55`);
        gradientFill.addColorStop(1, `${color}00`);

        const data = { labels: chartData.labels, datasets: [{ label, data: chartData.data, borderColor: color, backgroundColor: gradientFill, fill: true, tension: 0.4 }] };
        const options = { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true } } };
        renderChart(canvasId, 'line', data, options);
    };

    const renderBarChart = (canvasId, chartData, label, color, axis = 'x') => {
        if (!chartData || !chartData.data || chartData.data.length === 0) {
            showNoDataMessage(canvasId); return;
        }
        const data = { labels: chartData.labels, datasets: [{ label, data: chartData.data, backgroundColor: color, borderRadius: 4 }] };
        const options = { responsive: true, maintainAspectRatio: false, indexAxis: axis, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, grid: { display: axis === 'y' } }, y: { beginAtZero: true, grid: { display: axis === 'x' } } } };
        renderChart(canvasId, 'bar', data, options);
    };

    const renderDoughnutChart = (canvasId, chartData, colors) => {
        if (!chartData || !chartData.data || chartData.data.length === 0) {
            showNoDataMessage(canvasId); return;
        }
        const data = { labels: chartData.labels, datasets: [{ data: chartData.data, backgroundColor: colors, borderWidth: 4, borderColor: getComputedStyle(document.documentElement).getPropertyValue('--bg-main').trim() }] }; // Use theme background
        const options = { responsive: true, maintainAspectRatio: false, cutout: '70%', plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', padding: 20 } } } };
        renderChart(canvasId, 'doughnut', data, options);
    };

    // New 3D Bar Chart Renderer
    const render3DBarChart = (canvasId, chartData, label, colors) => {
        if (!chartData || !chartData.data || chartData.data.length === 0) {
            showNoDataMessage(canvasId); return;
        }
        const data = { labels: chartData.labels, datasets: [{ label, data: chartData.data, backgroundColor: colors[0], barThickness: 30 }] }; // Base color from first in array
        const options = {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { /* Standard tooltip config */ },
                customBar3D: { // Options for our plugin
                    baseColor: colors[0] || 'rgba(74, 144, 226, 1)',
                    topColor: 'rgba(255, 255, 255, 0.4)',
                    sideColor: 'rgba(0, 0, 0, 0.2)',
                    depth: 10
                }
            },
            scales: {
                x: { grid: { display: false }, ticks: { color: 'var(--text-secondary)' } },
                y: { beginAtZero: true, grid: { color: 'var(--border-color)' }, ticks: { color: 'var(--text-secondary)' } }
            }
        };
        renderChart(canvasId, 'bar', data, options, [bar3DPlugin]); // Pass the plugin
    };


    const renderDashboardMainChart = (chartData) => {
        if (!chartData || !chartData.consultations || !chartData.newPatients || chartData.consultations.length === 0) {
            showNoDataMessage('mainDashboardChart'); return;
        }
        const data = {
            labels: chartData.labels,
            datasets: [
                { label: 'Consultations', data: chartData.consultations, borderColor: 'rgba(59, 130, 246, 1)', backgroundColor: 'rgba(59, 130, 246, 0.1)', fill: true, tension: 0.4 },
                { label: 'New Patients', data: chartData.newPatients, borderColor: 'rgba(34, 197, 94, 1)', backgroundColor: 'rgba(34, 197, 94, 0.1)', fill: true, tension: 0.4 }
            ]
        };
        const options = { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' }, tooltip: { mode: 'index', intersect: false } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true } } };
        renderChart('mainDashboardChart', 'line', data, options);
    };

    const renderAnalyticsCharts = (data) => {
        console.log('Rendering analytics charts with data:', data);
        renderLineChart('consultationsChart', data.consultations, 'Consultations', '#22c55e');
        renderBarChart('topDiagnosesChart', data.diagnoses, 'Diagnoses', '#3b82f6', 'y'); // Horizontal bar
        renderBarChart('doctorLoadChart', data.doctorLoad, 'Consultations', '#f97316', 'y'); // Horizontal bar
        renderDoughnutChart('patientGenderChart', data.demographics?.gender, ['#3b82f6', '#f97316', '#6b7280']); // Colors for Male, Female, Other
        renderBarChart('patientAgeChart', data.demographics?.age, 'Patients', '#8b5cf6'); // Vertical bar for age groups

         // Example: Render 3D Specialties Chart (replace with real data if available)
        const specialties3DData = {
             labels: ['Cardiology', 'Dermatology', 'Neurology', 'Pediatrics', 'General'],
             data: [150, 120, 90, 200, 180] // Example data
        };
         const specialtyColors = ['#f472b6', '#34d399', '#facc15', '#60a5fa', '#a78bfa']; // Example colors
         render3DBarChart('specialties3DChart', specialties3DData, 'Top Specialties', specialtyColors);
    };

    // --- User Table Rendering ---
    const renderUserTable = (tableId, users, role) => {
        const tableBody = document.querySelector(`#${tableId} tbody`);
        if (!tableBody) return;
        tableBody.innerHTML = ''; // Clear existing rows
        users.forEach(user => {
            const row = tableBody.insertRow();
            row.dataset.id = user.id;
            row.dataset.username = user.username;
            row.dataset.role = role;
            row.className = 'border-b border-[var(--border-color)] hover:bg-[var(--bg-secondary)] transition-colors duration-150'; // Styling

            // Populate cells based on role
            row.insertCell().textContent = user.id;
            row.insertCell().textContent = user.username;
            row.insertCell().textContent = user.fullname;
            if (role === 'Doctor') row.insertCell().textContent = user.specialty || 'N/A';
            row.insertCell().textContent = user.email;
            row.insertCell().textContent = user.dob ? user.dob.split('T')[0] : 'N/A'; // Format date
            row.insertCell().textContent = user.address || 'N/A';
            row.insertCell().textContent = user.phone || 'N/A';

            // Action cell
            const actionCell = row.insertCell();
            actionCell.innerHTML = `<button class="px-3 py-1 text-xs font-semibold rounded-md shadow-sm transition-all transform hover:-translate-y-px neumorphic-flat" data-action="edit-user" data-id="${user.id}" data-role="${role}" style="color: var(--primary-accent-start);"><i class="fas fa-edit mr-1"></i>Edit</button>`;
        });
    };
    const renderPatients = (patients) => renderUserTable('patient-table', patients, 'Patient');
    const renderDoctors = (doctors) => renderUserTable('doctor-table', doctors, 'Doctor');
    // --- End User Table ---

    // --- View Switching Logic ---
    document.querySelectorAll('.sidebar-nav a').forEach(link => {
        link.addEventListener('click', (event) => {
             // Skip logout button
             if (event.currentTarget.id === 'logoutBtn') return;

            event.preventDefault();
            // Hide all content sections first
            document.querySelectorAll('.content-section').forEach(section => section.classList.add('hidden'));

            // Update active link styling
            document.querySelectorAll('.sidebar-nav a').forEach(item => {
                item.classList.remove('active-nav');
                const icon = item.querySelector('i');
                if(icon) icon.classList.remove('active-icon');
            });
            link.classList.add('active-nav');
             const icon = link.querySelector('i');
             if(icon) icon.classList.add('active-icon');

            // Show the target section
            const targetId = link.getAttribute('href').substring(1);
            const targetSection = document.getElementById(targetId);
            if (targetSection) {
                targetSection.classList.remove('hidden');

                // Fetch data for the newly shown section if needed
                if (targetId === 'dashboard-content') requestDashboardData();
                else if (targetId === 'user-management-content') requestUserManagementData();
                else if (targetId === 'analytics-content') requestAnalyticsData();
                else if (targetId === 'reviews-content') requestReviewsData(); // Fetch reviews when view selected
            }
        });
    });
    // --- End View Switching ---

     // --- Analytics Filter Button Logic ---
     document.querySelectorAll('.filter-controls .btn-filter').forEach(btn => {
         btn.addEventListener('click', (event) => {
             const chart = event.currentTarget.dataset.chart;
             const filter = event.currentTarget.dataset.filter;
             // Update button styles
             document.querySelectorAll(`.filter-controls .btn-filter[data-chart="${chart}"]`).forEach(b => {
                 b.classList.remove('bg-blue-600', 'text-white'); // Active state
                 b.classList.add('bg-gray-100', 'text-gray-700'); // Inactive state
             });
             event.currentTarget.classList.add('bg-blue-600', 'text-white');
             event.currentTarget.classList.remove('bg-gray-100', 'text-gray-700');

             // Emit request for updated chart data
             socket.emit(`admin:get:chart-data`, { chart, filter });
         });
     });

     // Range filter apply buttons
     document.querySelectorAll('.btn-primary[data-chart]').forEach(btn => {
         btn.addEventListener('click', () => {
             const chart = btn.dataset.chart;
             const startDate = document.getElementById(`${chart}-start-date`)?.value;
             const endDate = document.getElementById(`${chart}-end-date`)?.value;

             if (startDate && endDate) {
                 // Deactivate other filter buttons for this chart
                 document.querySelectorAll(`.filter-controls .btn-filter[data-chart="${chart}"]`).forEach(b => {
                     b.classList.remove('bg-blue-600', 'text-white');
                     b.classList.add('bg-gray-100', 'text-gray-700');
                 });
                 // Request data for the range
                 socket.emit(`admin:get:chart-data`, { chart, filter: 'range', range: { startDate, endDate } });
             } else {
                 alert('Please select both a start and end date for the custom range.');
             }
         });
     });
     // --- End Analytics Filters ---


    // --- Modal Handling ---
    const editModal = document.getElementById('editModal');
    const appointmentModal = document.getElementById('appointmentModal');
    const replyModal = document.getElementById('replyModal'); // Get reply modal

    const hideAllModals = () => {
        if(editModal) editModal.classList.add('hidden');
        if(appointmentModal) appointmentModal.classList.add('hidden');
         if(replyModal) replyModal.classList.add('hidden'); // Hide reply modal too
    };

    // Close buttons within modals
    document.getElementById('editModalClose')?.addEventListener('click', hideAllModals);
    document.getElementById('closeAppointmentModal')?.addEventListener('click', hideAllModals);
    document.getElementById('closeReplyModal')?.addEventListener('click', hideAllModals); // Add close for reply modal

    // Click outside modal to close
    document.addEventListener('click', (event) => {
        if (event.target === editModal || event.target === appointmentModal || event.target === replyModal) {
            hideAllModals();
        }
    });

    // Edit User Modal Form Elements
    const editForm = document.getElementById('editForm');
    const editUserId = document.getElementById('editUserId');
    const editOldUsername = document.getElementById('editOldUsername'); // Store original username
    const editUserRole = document.getElementById('editUserRole');
    const editUsernameInput = document.getElementById('editUsername');
    const editFullnameInput = document.getElementById('editFullname');
    const editEmailInput = document.getElementById('editEmail');
    const editDobInput = document.getElementById('editDob');
    const editAddressInput = document.getElementById('editAddress');
    const editPhoneInput = document.getElementById('editPhone');
    const specialtyGroup = document.getElementById('specialty-group');
    const editSpecialtyInput = document.getElementById('editSpecialty');
    const newPasswordInput = document.getElementById('newPassword');
    const resetPasswordBtn = document.getElementById('resetPasswordBtn');
    const deleteUserBtn = document.getElementById('deleteUserBtn');

    // --- User Management Table Click Listener (for Edit button) ---
    document.querySelector('#user-management-content').addEventListener('click', (event) => {
        const targetBtn = event.target.closest('button[data-action="edit-user"]');
        if (targetBtn) {
            const targetRow = targetBtn.closest('tr');
            if (targetRow && targetRow.dataset.id) {
                const id = targetRow.dataset.id;
                const oldUsername = targetRow.cells[1].textContent; // Get username from cell
                const role = targetRow.dataset.role; // Get role from row data attribute

                let fullname, email, dob, address, phone, specialty = '';

                // Extract data based on role (column indices might differ)
                if (role === 'Patient') {
                    fullname = targetRow.cells[2].textContent;
                    email = targetRow.cells[3].textContent;
                    dob = targetRow.cells[4].textContent;
                    address = targetRow.cells[5].textContent;
                    phone = targetRow.cells[6].textContent;
                } else if (role === 'Doctor') {
                    fullname = targetRow.cells[2].textContent;
                    specialty = targetRow.cells[3].textContent;
                    email = targetRow.cells[4].textContent;
                    dob = targetRow.cells[5].textContent;
                    address = targetRow.cells[6].textContent;
                    phone = targetRow.cells[7].textContent;
                }

                // Populate modal fields
                editUserId.value = id;
                editOldUsername.value = oldUsername; // Store the original username
                editUserRole.value = role;
                editUsernameInput.value = oldUsername; // Pre-fill with current username
                editFullnameInput.value = fullname || '';
                editEmailInput.value = email || '';
                editDobInput.value = dob || ''; // Use YYYY-MM-DD format if available
                editAddressInput.value = address || '';
                editPhoneInput.value = phone || '';

                // Show/hide specialty field
                specialtyGroup.classList.toggle('hidden', role !== 'Doctor');
                if (role === 'Doctor') {
                    editSpecialtyInput.value = specialty || '';
                }

                 newPasswordInput.value = ''; // Clear password field

                // Show the modal
                editModal.classList.remove('hidden');
            }
        }
    });
    // --- End User Management Click Listener ---


    // --- Edit Modal Form Submission ---
    editForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const id = editUserId.value;
        const oldUsername = editOldUsername.value; // Get original username
        const newUsername = editUsernameInput.value; // Get potentially edited username
        const role = editUserRole.value;
        const fullname = editFullnameInput.value;
        const email = editEmailInput.value;
        const dob = editDobInput.value;
        const address = editAddressInput.value;
        const phone = editPhoneInput.value;
        const specialty = editSpecialtyInput.value;

        // --- Username Change Handling ---
        if (newUsername !== oldUsername) {
            if (confirm(`You are changing the username from "${oldUsername}" to "${newUsername}". This will update all associated records. Proceed?`)) {
                 // Emit event specifically for username update
                 socket.emit('admin:update:username', { id, oldUsername, newUsername }, (response) => {
                     if (response.success) {
                         alert(response.message);
                         // After successful username change, update the other details using the *new* username
                         updateOtherDetails(id, newUsername, role, fullname, email, dob, address, phone, specialty);
                     } else {
                         alert(`Username update failed: ${response.message}`);
                         // Optionally revert username input field
                         editUsernameInput.value = oldUsername;
                     }
                 });
            } else {
                 editUsernameInput.value = oldUsername; // Revert if user cancels confirm
            }
        } else {
            // If username hasn't changed, just update other details
            updateOtherDetails(id, oldUsername, role, fullname, email, dob, address, phone, specialty);
        }
    });

    // Helper function to update non-username details
    const updateOtherDetails = (id, username, role, fullname, email, dob, address, phone, specialty) => {
        const updatedData = { id, fullname, email, role, dob, address, phone };
        if (role === 'Doctor') {
            updatedData.specialty = specialty;
        }
        // Emit event to update general user details
        socket.emit('admin:update:user', updatedData, (response) => {
            alert(response.message); // Show success/failure message for detail update
            if (response.success) {
                hideAllModals(); // Close modal on successful update
                 // No need to manually refresh here, 'admin:user-list:updated' should trigger it
            }
        });
    };
    // --- End Edit Modal Logic ---

    // --- Delete User Button ---
    deleteUserBtn.addEventListener('click', () => {
        const id = editUserId.value;
         const usernameToDelete = editUsernameInput.value; // Get username for confirmation message
        if (confirm(`Are you absolutely sure you want to delete user "${usernameToDelete}" (ID: ${id})? This action cannot be undone.`)) {
            socket.emit('admin:delete:user', { id }, (response) => {
                alert(response.message);
                if (response.success) {
                    hideAllModals();
                    // No need to manually refresh here, 'admin:user-list:updated' should trigger it
                }
            });
        }
    });

    // --- Reset Password Button ---
    resetPasswordBtn.addEventListener('click', () => {
        const id = editUserId.value;
         const usernameToReset = editUsernameInput.value; // Get username for confirmation
        const newPassword = newPasswordInput.value;
        if (newPassword.length < 6) {
            alert('Password must be at least 6 characters long.');
            return;
        }
        if (confirm(`Are you sure you want to reset the password for user "${usernameToReset}" (ID: ${id})?`)) {
            socket.emit('admin:reset:password', { id, newPassword }, (response) => {
                alert(response.message);
                if (response.success) {
                    hideAllModals(); // Close modal on success
                     newPasswordInput.value = ''; // Clear password field
                }
            });
        }
    });

    // --- Review Management ---
    // FIX: Define requestReviewsData only ONCE inside DOMContentLoaded
    const requestReviewsData = () => {
        console.log('Requesting review data...');
        // Placeholder: Replace with actual socket emit event for reviews
        // socket.emit('admin:get:reviews', (response) => { ... });

        // Using Dummy Data for demonstration
        const dummyReviews = [
            { id: 1, patientName: 'Alice P.', doctorName: 'Dr. Smith', rating: 5, comment: 'Excellent service, very thorough!', timestamp: new Date(Date.now() - 86400000).toISOString(), status: 'Pending' },
            { id: 2, patientName: 'Bob M.', doctorName: 'Dr. Jones', rating: 4, comment: 'Helpful consultation, but the wait time via video call link was a bit long.', timestamp: new Date(Date.now() - 172800000).toISOString(), status: 'Approved' },
            { id: 3, patientName: 'Charlie D.', doctorName: 'Dr. Smith', rating: 3, comment: 'Okay experience, felt a bit rushed.', timestamp: new Date(Date.now() - 259200000).toISOString(), status: 'Pending', reply: 'Thank you for your feedback, Charlie. We apologize if the consultation felt rushed and are working on managing appointment times better.' },
            { id: 4, patientName: 'Diana R.', doctorName: 'Dr. Lee', rating: 5, comment: 'Very professional and caring.', timestamp: new Date(Date.now() - 345600000).toISOString(), status: 'Approved', reply: 'Thank you for your kind words, Diana!' },
        ];
        renderReviews(dummyReviews);
    };

     const renderReviews = (reviews) => {
         const reviewList = document.getElementById('review-list');
         if (!reviewList) return;
         reviewList.innerHTML = ''; // Clear previous

         if (!reviews || reviews.length === 0) {
             reviewList.innerHTML = '<li class="text-center text-gray-500 italic p-4">No reviews found.</li>';
             return;
         }

         reviews.forEach(review => {
             const li = document.createElement('li');
             li.className = 'review-card neumorphic-flat p-4 mb-4'; // Add neumorphic style
             li.dataset.reviewId = review.id;

             const ratingStars = Array(5).fill(0).map((_, i) =>
                 `<i class="fas fa-star ${i < review.rating ? 'text-yellow-400' : 'text-gray-300'}"></i>`
             ).join('');

             let actionsHtml = '';
             if (review.status === 'Pending') {
                 actionsHtml = `
                     <button class="approve-btn px-3 py-1 text-xs font-semibold rounded-md shadow-sm transition-all transform hover:-translate-y-px neumorphic-flat" style="color: var(--ui-success);" data-review-id="${review.id}"><i class="fas fa-check mr-1"></i>Approve</button>
                     <button class="reject-btn px-3 py-1 text-xs font-semibold rounded-md shadow-sm transition-all transform hover:-translate-y-px neumorphic-flat" style="color: var(--danger-color);" data-review-id="${review.id}"><i class="fas fa-times mr-1"></i>Reject</button>
                 `;
             } else if (review.status === 'Approved' && !review.reply) {
                 actionsHtml = `<button class="reply-btn px-3 py-1 text-xs font-semibold rounded-md shadow-sm transition-all transform hover:-translate-y-px neumorphic-flat" style="color: var(--primary-accent-start);" data-review-id="${review.id}"><i class="fas fa-reply mr-1"></i>Reply</button>`;
             }

             li.innerHTML = `
                 <div class="review-header flex justify-between items-center mb-2">
                     <div>
                         <span class="font-semibold text-[var(--text-primary)]">${review.patientName}</span>
                         <span class="text-xs text-[var(--text-secondary)]"> reviewed Dr. ${review.doctorName}</span>
                     </div>
                     <span class="text-xs text-[var(--text-secondary)]">${new Date(review.timestamp).toLocaleDateString()}</span>
                 </div>
                 <div class="review-rating mb-2">${ratingStars}</div>
                 <div class="review-body mb-3">
                     <p class="text-sm text-[var(--text-secondary)] italic">"${review.comment}"</p>
                 </div>
                 ${review.reply ? `<div class="review-reply mt-3 pt-3 border-t border-[var(--border-color)]"><p class="text-sm font-semibold text-[var(--text-primary)]">Admin Reply:</p><p class="text-sm text-[var(--text-secondary)]">${review.reply}</p></div>` : ''}
                 <div class="review-actions flex gap-2 mt-3 justify-end">
                     ${actionsHtml}
                     <span class="text-xs font-bold px-2 py-1 rounded ${review.status === 'Approved' ? 'bg-green-100 text-green-700' : review.status === 'Rejected' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}">${review.status}</span>
                 </div>
             `;
             reviewList.appendChild(li);
         });
     };


     // --- Review Action Event Listener (Delegated) ---
     document.getElementById('reviews-content').addEventListener('click', (event) => {
         const targetBtn = event.target.closest('button');
         if (!targetBtn) return;
         const reviewId = targetBtn.dataset.reviewId;
         if (!reviewId) return;

         if (targetBtn.classList.contains('approve-btn')) {
             console.log(`Approving review ID: ${reviewId}`);
             socket.emit('admin:review:approve', { reviewId }, (response) => {
                 alert(response.message);
                 if (response.success) requestReviewsData(); // Refresh list
             });
         } else if (targetBtn.classList.contains('reject-btn')) {
             if (confirm('Are you sure you want to reject this review?')) {
                 console.log(`Rejecting review ID: ${reviewId}`);
                 socket.emit('admin:review:reject', { reviewId }, (response) => {
                     alert(response.message);
                     if (response.success) requestReviewsData(); // Refresh list
                 });
             }
         } else if (targetBtn.classList.contains('reply-btn')) {
             // Open reply modal
             const reviewCard = targetBtn.closest('.review-card');
             const reviewTextElement = reviewCard?.querySelector('.review-body p');
             const reviewText = reviewTextElement ? reviewTextElement.textContent.replace(/"/g, '') : 'Could not load review text.'; // Get text, remove quotes

             document.getElementById('replyReviewId').value = reviewId;
             document.getElementById('replyReviewText').textContent = reviewText;
             document.getElementById('replyMessage').value = ''; // Clear previous reply
             showModal('replyModal');
         }
     });

     // --- Reply Form Submission ---
     document.getElementById('replyForm').addEventListener('submit', (event) => {
         event.preventDefault();
         const reviewId = document.getElementById('replyReviewId').value;
         const replyMessage = document.getElementById('replyMessage').value.trim();

         if (!replyMessage) {
             alert('Reply cannot be empty.'); return;
         }

         console.log(`Submitting reply for review ID ${reviewId}`);
         socket.emit('admin:review:reply', { reviewId, replyMessage }, (response) => {
             alert(response.message);
             if (response.success) {
                 hideModal('replyModal');
                 event.target.reset(); // Reset form
                 requestReviewsData(); // Refresh review list
             }
         });
     });
     // --- End Review Management ---

    // --- Logout Button ---
    document.getElementById('logoutBtn').addEventListener('click', () => {
        localStorage.removeItem('telemedicine_user');
        localStorage.removeItem('telemedicine_role');
        alert('You have been logged out.');
        window.location.href = '/'; // Redirect to login page
    });
    // --- End Logout ---

     // --- Calendar Initialization (Dashboard View) ---
     const calendarEl = document.getElementById('calendar');
     if (calendarEl) {
         calendarInstance = new FullCalendar.Calendar(calendarEl, {
             initialView: 'dayGridMonth',
             headerToolbar: false, // Buttons are handled outside
             height: '100%', // Fill container
             events: [], // Start with empty events
             eventColor: 'var(--primary-accent-start)',
             eventClick: function(info) {
                 // Open appointment details modal on click
                 const appointmentId = info.event.id;
                 showAppointmentModal(appointmentId);
             }
         });
         calendarInstance.render();
     } else {
         console.error('Calendar element not found');
     }

     function fetchCalendarData() {
         const start = calendarInstance ? calendarInstance.view.activeStart.toISOString().split('T')[0] : new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
         const end = calendarInstance ? calendarInstance.view.activeEnd.toISOString().split('T')[0] : new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().split('T')[0];

         console.log(`Fetching calendar events from ${start} to ${end}`);

         socket.emit('admin:get:calendar-appointments', { start, end }, (response) => {
             if (response.success) {
                 console.log('Received calendar appointments:', response.appointments);
                 renderCalendarEvents(response.appointments);
             } else {
                 console.error('Failed to fetch calendar data:', response.message);
             }
         });
     }

     function renderCalendarEvents(appointments) {
         if (!calendarInstance) return;

         const events = appointments.map(app => {
            // Combine date and time, handle potential null time
            const startDateTime = app.appointmentTime
                ? `${app.appointmentDate.split('T')[0]}T${app.appointmentTime}`
                : app.appointmentDate.split('T')[0]; // If no time, make it an all-day event for that date

            return {
                 id: app.id.toString(), // Ensure ID is a string
                 title: `Appt #${app.id}: ${app.patientFullName || app.patientName} w/ Dr. ${app.doctorFullName || app.doctorName}`,
                 start: startDateTime,
                 allDay: !app.appointmentTime, // Set allDay based on time presence
                 extendedProps: {
                     status: app.status,
                     patient: app.patientFullName || app.patientName,
                     doctor: app.doctorFullName || app.doctorName,
                     date: app.appointmentDate.split('T')[0],
                     time: app.appointmentTime
                 },
                 // Optionally set color based on status
                 color: getCalendarEventColor(app.status), // Use your existing color function
                 // textColor: '#ffffff' // Ensure text is visible
            };
         });
         console.log('Formatted calendar events:', events);
         calendarInstance.removeAllEvents(); // Clear previous events
         calendarInstance.addEventSource(events); // Add new events
     }


     // Function to get event color based on status (ensure this exists or adapt)
     function getCalendarEventColor(status) {
        switch(status) {
            case 'Pending': return '#ffc107'; // Yellow
            case 'Accepted': case 'Confirmed': return '#4a90e2'; // Blue
            case 'Completed': return '#28a745'; // Green
            case 'Cancelled': case 'Rejected': return '#e57373'; // Red
            default: return '#6c757d'; // Gray
        }
     }

    // --- Show Appointment Modal from Calendar Click ---
     function showAppointmentModal(appointmentId) {
        // Find appointment details (assuming you have an array `allAppointments` or similar)
        // This part needs adjustment based on how you fetch/store all appointment details
        // For now, let's assume `socket.emit('admin:get:appointment-details', ...)` exists
        socket.emit('admin:get:appointment-details', { id: appointmentId }, (response) => {
             if (response.success && response.appointment) {
                 const app = response.appointment;
                 document.getElementById('appointmentId').value = app.id;
                 document.getElementById('modalPatientName').textContent = app.patientFullName || app.patientName;
                 document.getElementById('modalDoctorName').textContent = app.doctorFullName || app.doctorName || 'N/A';
                 document.getElementById('modalAppointmentDate').textContent = `${app.appointmentDate.split('T')[0]} at ${app.appointmentTime}`;
                 document.getElementById('appointmentStatus').value = app.status;
                 showModal('appointmentModal');
             } else {
                 alert('Could not retrieve appointment details.');
             }
         });
     }

    // --- Update Appointment Status Form ---
     document.getElementById('appointmentForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const id = document.getElementById('appointmentId').value;
        const status = document.getElementById('appointmentStatus').value;
        socket.emit('admin:update:appointment-status', { id, status }, (response) => {
            alert(response.message);
            if(response.success) {
                 hideAllModals();
                 // Re-fetch dashboard/calendar data as status changed
                 requestDashboardData();
            }
        });
    });


}); // End DOMContentLoaded

// admin-dashboard.js