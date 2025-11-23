/* Final Version - Cleaned, Verified, and Themed - with Profile Fixes */
'use strict';

document.addEventListener('DOMContentLoaded', () => {
    let currentUsername = null;
    let currentUserFullName = '';
    let appointments = [];
    let userProfile = {};
    let currentConversations = [];
    let selectedDoctorUsername = null;
    let selectedConversationAppointmentId = null;

    const socket = io();

    let selectedAppointmentForReschedule = null;

    const sidebar = document.querySelector('.sidebar');
    const sidebarToggle = document.querySelector('.sidebar-toggle');
    const overlay = document.querySelector('.overlay');
    const userDropdownToggle = document.getElementById('userDropdownToggle');
    const userMenu = document.getElementById('user-menu');
    const headerUsernameDisplay = document.getElementById('header-username');
    const helpToggleBtn = document.getElementById('help-toggle-btn');

    let refreshInterval;

    // --- Notification Sound ---
    const notificationSound = new Audio('/sounds/mixkit-software-interface-start-2574.wav');

    function toggleSidebar() {
        const isSidebarOpen = sidebar.classList.toggle('is-open');
        overlay.classList.toggle('is-visible');
        document.body.classList.toggle('scroll-lock', isSidebarOpen);
        if (sidebarToggle) {
            sidebarToggle.setAttribute('aria-expanded', isSidebarOpen);
        }
    }

    function toggleUserDropdown(event) {
        if (event) event.stopPropagation();
        const isOpen = userMenu.classList.toggle('show');
        if (userDropdownToggle) {
            userDropdownToggle.classList.toggle('is-open', isOpen);
            userDropdownToggle.setAttribute('aria-expanded', isOpen);
        }
    }

    const checkScreenSize = () => {
        if (window.innerWidth > 992) {
            sidebar.classList.remove('is-open');
            overlay.classList.remove('is-visible');
            document.body.classList.remove('scroll-lock');
        }
    };

    if (sidebarToggle) sidebarToggle.addEventListener('click', toggleSidebar);
    if (overlay) overlay.addEventListener('click', toggleSidebar);
    if (userDropdownToggle) userDropdownToggle.addEventListener('click', toggleUserDropdown);

    window.addEventListener('resize', checkScreenSize);
    checkScreenSize();

    let notificationTimeout;
    function showNotification(message, isError = false) {
        const banner = document.getElementById('notification-banner');
        if (!banner) return;
        clearTimeout(notificationTimeout);
        banner.textContent = message;
        banner.className = 'notification-banner'; // Reset classes
        if (isError) {
            banner.classList.add('error');
        }
        banner.classList.add('show');
        notificationTimeout = setTimeout(() => {
            banner.classList.remove('show');
        }, 4000); // Hide after 4 seconds

        // Play sound (if not an error)
        if (!isError && notificationSound) {
            notificationSound.play().catch(e => console.error("Audio play failed:", e));
        }
    }


    function showView(viewName) {
        document.querySelectorAll('.view-container').forEach(view => view.classList.add('hidden'));
        const activeView = document.getElementById(`${viewName}-view`);
        if (activeView) {
            activeView.classList.remove('hidden');
        }
        document.querySelectorAll('.sidebar-nav a').forEach(link => {
            link.classList.remove('active');
        });
        const activeLink = document.querySelector(`.nav-link[data-view="${viewName}"]`);
        if (activeLink) {
            activeLink.classList.add('active');
        }
        let title;
        if (viewName === 'my-health') {
            title = 'Consultation History';
        } else if (viewName === 'my-profile') {
            title = 'My Profile';
        } else if (viewName === 'request-appointment') { // Special case for modal trigger
            title = 'Request an Appointment';
            openModal('appointment-modal');
            document.getElementById('main-header-title').textContent = title; 
            return; 
        } else {
            title = viewName.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase());
        }
        document.getElementById('main-header-title').textContent = title;

        // Add body class for messages view scrolling fix
        const bodyEl = document.body;
        if (viewName === 'messages') {
            bodyEl.classList.add('messages-active');
        } else {
            bodyEl.classList.remove('messages-active');
        }


        // Trigger data rendering/fetching based on view
        if (viewName === 'my-health') {
            renderConsultationHistory();
        } else if (viewName === 'dashboard') {
            renderDashboardAppointments();
        } else if (viewName === 'messages') {
            fetchPatientConversations(); 
        } else if (viewName === 'my-profile') {
            renderMyProfile(); 
        }
    }


    function openModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.add('show');
            document.body.classList.add('modal-open'); 
        }
    }

    function closeModal(modalElement) {
        if (modalElement) {
            modalElement.classList.remove('show');
            document.body.classList.remove('modal-open');

            // Reset form inside the modal if it exists
            const form = modalElement.querySelector('form');
            if (form) {
                form.reset();
            }
        }
    }

    // --- Call Details Modal Logic ---
    function updateCallModalStatus(appointment) {
        const statusContainer = document.getElementById('call-status-container');
        const statusMessage = document.getElementById('call-status-message');
        const readyDetails = document.getElementById('ready-call-details');
        const joinButton = document.getElementById('modal-join-button');

        if (appointment && appointment.authToken) {
            statusContainer.className = 'call-status-container ready p-4 rounded-lg bg-green-100 text-green-700 mt-4';
            statusMessage.textContent = 'The room is ready. You can join the call now.';
            readyDetails.classList.remove('hidden');
            joinButton.classList.remove('disabled');
            joinButton.removeAttribute('disabled');

            // Construct the correct call link
            const callLink = `${window.location.origin}/call/${appointment.id}?token=${appointment.authToken}`;

            // Generate QR Code
            const qrCodeCanvas = document.getElementById('qr-code-canvas');
            if (qrCodeCanvas && typeof QRCode !== 'undefined') {
                 const isDark = document.documentElement.classList.contains('dark');
                 const qrDarkColor = isDark ? '#EEEEEE' : '#1A202C'; // Text color
                 const qrLightColor = isDark ? '#1E1E1E' : '#FFFFFF'; // Background color
                QRCode.toCanvas(qrCodeCanvas, callLink, { width: 180, color: { dark: qrDarkColor, light: qrLightColor } }, (error) => {
                    if (error) console.error('QR code generation failed', error);
                });
            } else {
                console.warn('QR code canvas or library not found.');
            }

            // Update Link
            const modalCallLink = document.getElementById('modal-call-link');
            if (modalCallLink) {
                modalCallLink.href = callLink;
                modalCallLink.textContent = "Click here to open the call link";
                 modalCallLink.onclick = (e) => { // Prevent default and navigate
                      e.preventDefault();
                      window.location.href = callLink;
                 };
            }

            // Update Join Button Action
             joinButton.onclick = (e) => {
                 e.preventDefault();
                 window.location.href = callLink;
             };


        } else {
            statusContainer.className = 'call-status-container not-ready p-4 rounded-lg bg-yellow-100 text-yellow-700 mt-4';
            statusMessage.textContent = 'The doctor has not started the call yet. Please wait.';
            readyDetails.classList.add('hidden');
            joinButton.classList.add('disabled');
            joinButton.setAttribute('disabled', 'true');
            joinButton.href = '#'; 
            joinButton.onclick = null; 
        }
    }


    function showPatientCallDetailsModal(appointment) {
        const modal = document.getElementById('patient-call-details-modal');
        if (!modal) return;
        modal.dataset.appointmentId = appointment.id; 
        document.getElementById('modal-doctor-name').textContent = `Dr. ${appointment.doctorName || 'N/A'}`;
        document.getElementById('modal-appointment-date').textContent = appointment.appointmentDate ? new Date(appointment.appointmentDate.split('T')[0] + 'T00:00:00').toLocaleDateString() : 'N/A';
        document.getElementById('modal-appointment-time').textContent = appointment.appointmentTime || 'N/A';
        updateCallModalStatus(appointment); 
        openModal('patient-call-details-modal');
    }

     function showAppointmentNotesModal(appointment) {
        const modal = document.getElementById('patient-notes-modal');
        if (!modal) return;

        const notesLabel = document.getElementById('notes-label');
        const notesContentDiv = document.getElementById('notes-modal-notes');
        const downloadBtn = document.getElementById('downloadSummaryBtn');

        document.getElementById('notes-modal-doctor-name').textContent = `Dr. ${appointment.doctorName || 'N/A'}`;
        document.getElementById('notes-modal-specialty').textContent = appointment.specialty || 'N/A';
        document.getElementById('notes-modal-date').textContent = new Date(appointment.appointmentDate).toLocaleString('en-US', { dateStyle: 'long' }) || 'N/A';

        if (appointment.status === 'Rejected') {
            notesLabel.textContent = 'Reason:';
            notesContentDiv.textContent = appointment.rejectionNotes || 'No reason provided.';
            downloadBtn.style.display = 'none'; // Hide download for rejection
        } else { 
            notesLabel.textContent = "Doctor's Notes/Diagnosis:";
            notesContentDiv.textContent = appointment.notes || 'No notes were provided for this appointment.';
            downloadBtn.style.display = 'block'; // Show download for notes
        }

        openModal('patient-notes-modal');
    }

    function openRescheduleResponseModal(appointment) {
        selectedAppointmentForReschedule = appointment;
        const modal = document.getElementById('reschedule-response-modal');
        
        if (modal) {
            const doctorNameEl = document.getElementById('reschedule-doctor-name');
            const newTimeEl = document.getElementById('reschedule-new-time');
            
            if (doctorNameEl) {
                doctorNameEl.textContent = `Dr. ${appointment.doctorName || 'N/A'}`;
            }
            
            if (newTimeEl) {
                const appDate = appointment.appointmentDate ? new Date(appointment.appointmentDate.split('T')[0] + 'T00:00:00') : null;
                const formattedDate = appDate ? appDate.toLocaleDateString() : 'N/A';
                newTimeEl.textContent = `${formattedDate} at ${appointment.appointmentTime}`;
            }
            
            openModal('reschedule-response-modal');
        }
    }

    // --- Appointment Rendering Logic ---
    function renderDashboardAppointments() {
        console.log('[Patient][Render] Starting renderDashboardAppointments...'); 
        const upcomingList = document.getElementById('upcoming-appointments-list');
        const pendingList = document.getElementById('pending-appointments-list');
        const rescheduleList = document.getElementById('reschedule-requests-list');
        if (!upcomingList || !pendingList || !rescheduleList) {
             console.error("[Patient][Render] Dashboard list elements not found!");
             return;
        }

        upcomingList.innerHTML = '';
        pendingList.innerHTML = '';
        rescheduleList.innerHTML = '';

        const upcomingAppointments = appointments.filter(app => app.patientName === currentUsername && app.status === 'Accepted');
        const pendingAppointments = appointments.filter(app => app.patientName === currentUsername && app.status === 'Pending');
        const rescheduleRequests = appointments.filter(app => app.patientName === currentUsername && app.status === 'Rescheduled-Pending');

        // Render Upcoming Appointments
        if (upcomingAppointments.length === 0) {
            upcomingList.innerHTML = `
                <div class="placeholder-container flex flex-col justify-center items-center text-center p-10 h-full">
                    <i class="fas fa-calendar-check text-5xl text-[var(--primary-color)] mb-4"></i>
                    <p class="text-sm text-[var(--text-secondary)] m-0 mb-5">No upcoming appointments scheduled.</p>
                    <button class="action-btn primary" id="request-appt-from-placeholder-1" data-modal="appointment-modal"><i class="fas fa-plus"></i>Request an Appointment</button>
                </div>`;
        } else {
            upcomingAppointments.forEach(app => {
                const li = document.createElement('li');
                li.className = 'visit-item accepted';
                li.dataset.appointmentId = app.id;
                const appDate = app.appointmentDate ? new Date(app.appointmentDate.split('T')[0] + 'T00:00:00') : null;
                const formattedDate = appDate ? appDate.toLocaleDateString() : 'N/A';
                li.innerHTML = `
                    <div class="info-block">
                        <div class="service-name">${app.subject}</div>
                        <div class="doctor-name">Dr. ${app.doctorName || 'N/A'} (${app.specialty})</div>
                        <div class="date-time text-xs text-[var(--text-secondary)]">${formattedDate} at ${app.appointmentTime || ''}</div>
                    </div>
                    <div class="actions-block">
                        <span class="status-tag accepted">${app.status}</span>
                    </div>`;
                upcomingList.appendChild(li);
            });
        }

        // Render Pending Appointments
        if (pendingAppointments.length === 0) {
            pendingList.innerHTML = `
                <div class="placeholder-container flex flex-col justify-center items-center text-center p-10 h-full">
                    <i class="fas fa-hourglass-half text-5xl text-[var(--primary-color)] mb-4"></i>
                    <p class="text-sm text-[var(--text-secondary)] m-0 mb-5">You have no new appointment requests.</p>
                </div>`;
        } else {
            pendingAppointments.forEach(app => {
                const li = document.createElement('li');
                li.className = 'visit-item pending';
                li.dataset.appointmentId = app.id;
                const appDate = app.appointmentDate ? new Date(app.appointmentDate.split('T')[0] + 'T00:00:00') : null;
                const formattedDate = appDate ? appDate.toLocaleDateString() : 'N/A';
                li.innerHTML = `
                    <div class="info-block">
                        <div class="service-name">${app.subject}</div>
                        <div class="doctor-name">Seeking (${app.specialty})</div>
                         <div class="date-time text-xs text-[var(--text-secondary)]">Requested for ${formattedDate} at ${app.appointmentTime || ''}</div>
                    </div>
                    <div class="actions-block flex items-center gap-2">
                       <button class="action-btn secondary cancel-request-btn p-2 w-10 h-10" data-appointment-id="${app.id}" title="Cancel Request"> <i class="fas fa-trash-alt"></i></button>
                        <span class="status-tag pending">${app.status}</span>
                    </div>`;
                pendingList.appendChild(li);
            });
        }

        // Render Reschedule Requests
        if (rescheduleRequests.length === 0) {
            rescheduleList.innerHTML = `
                <div class="placeholder-container flex flex-col justify-center items-center text-center p-10 h-full">
                    <i class="fas fa-clock text-5xl text-[var(--primary-color)] mb-4"></i>
                    <p class="text-sm text-[var(--text-secondary)] m-0 mb-5">You have no pending reschedule requests.</p>
                </div>`;
        } else {
            rescheduleRequests.forEach(app => {
                const li = document.createElement('li');
                li.className = 'visit-item rescheduled-pending';
                li.dataset.appointmentId = app.id;
                const appDate = app.appointmentDate ? new Date(app.appointmentDate.split('T')[0] + 'T00:00:00') : null;
                const formattedDate = appDate ? appDate.toLocaleDateString() : 'N/A';
                 li.innerHTML = `
                    <div class="info-block">
                        <div class="service-name">${app.subject}</div>
                        <div class="doctor-name">Dr. ${app.doctorName || 'N/A'} proposed new time</div>
                        <div class="date-time text-xs text-[var(--text-secondary)]">New: ${formattedDate} at ${app.appointmentTime || ''}</div>
                    </div>
                    <div class="actions-block">
                        <button class="action-btn primary respond-reschedule-btn" data-appointment-id="${app.id}">Respond</button>
                    </div>`;
                rescheduleList.appendChild(li);
            });
        }
        console.log('[Patient][Render] Finished renderDashboardAppointments.'); 
    }


    // --- Consultation History Rendering ---
    function renderConsultationHistory() {
        const historyList = document.getElementById('consultation-history-list');
        if (!historyList) return;
        historyList.innerHTML = ''; 
        const pastAppointments = appointments.filter(app => app.patientName === currentUsername && (app.status === 'Completed' || app.status === 'Rejected'));

        if (pastAppointments.length === 0) {
            historyList.innerHTML = `
                <div class="col-span-full text-center p-10 card">
                    <i class="fas fa-file-medical-alt text-5xl text-[var(--primary-color)] mb-4"></i>
                    <p class="text-sm text-[var(--text-secondary)]">No past consultations to display.</p>
                </div>`;
            return;
        }

        pastAppointments.sort((a, b) => new Date(b.appointmentDate) - new Date(a.appointmentDate));

        pastAppointments.forEach(app => {
            const card = document.createElement('div');
            const statusClass = app.status.toLowerCase();
            card.className = `consultation-card ${statusClass} flex flex-col`; 
            card.dataset.appointmentId = app.id;

            let actionText = app.status === 'Rejected' ? 'View Reason' : 'View Summary';
            const appDate = app.appointmentDate ? new Date(app.appointmentDate.split('T')[0] + 'T00:00:00') : null;
            const formattedDate = appDate ? appDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric'}) : 'N/A';

            card.innerHTML = `
                <div class="consultation-card-header flex justify-between items-center p-4">
                    <div>
                        <h4 class="text-md font-semibold text-[var(--text-primary)]">Dr. ${app.doctorName || 'N/A'}</h4>
                        <p class="text-sm text-[var(--text-secondary)]">${app.specialty || 'N/A'}</p>
                    </div>
                    <span class="status-badge ${statusClass} text-xs font-bold text-white py-1 px-3 rounded-full">${app.status}</span>
                </div>
                <div class="p-4 flex-grow flex flex-col">
                    <p class="text-sm text-[var(--text-secondary)] mb-4">
                        <i class="fas fa-calendar-alt mr-2"></i>${formattedDate}
                    </p>
                    <div class="mt-auto"> <button class="action-btn secondary view-notes-btn w-full !font-medium !py-2">${actionText}</button>
                    </div>
                </div>`;
            historyList.appendChild(card);
        });
    }


    // --- Profile Rendering ---
    function renderMyProfile() {
        if (!userProfile || Object.keys(userProfile).length === 0) {
            console.warn("User profile data not available for rendering.");
            return; 
        }

        // --- 1. Fix Profile Picture Logic ---
        const profileAvatar = document.querySelector('.profile-avatar');
        const headerAvatar = document.querySelector('.user-avatar');
        const defaultAvatarPath = '/images/default-avatar.png'; 

        const setAvatarSource = (imgElement, src) => {
            if (imgElement) {
                // Determine if src is a valid data URL or path, otherwise use default
                const validSrc = (src && (src.startsWith('data:image') || src.startsWith('/') || src.startsWith('http'))) 
                                ? src 
                                : defaultAvatarPath;
                imgElement.src = validSrc;
                imgElement.onerror = () => { imgElement.src = defaultAvatarPath; }; 
            }
        };

        setAvatarSource(profileAvatar, userProfile.profilePicture);
        setAvatarSource(headerAvatar, userProfile.profilePicture);

        // --- 2. Fix Full Name Display ---
        // Prioritize explicit fullName, fall back to First+Last, then Username
        let displayFullName = userProfile.fullName;
        if (!displayFullName && userProfile.firstName && userProfile.lastName) {
            displayFullName = `${userProfile.firstName} ${userProfile.lastName}`;
        }
        if (!displayFullName) {
            displayFullName = userProfile.username || 'N/A';
        }

        // Calculate Age
        let ageText = 'N/A';
        if (userProfile.dob) {
             try {
                 const birthDate = new Date(userProfile.dob);
                 const today = new Date();
                 let calculatedAge = today.getFullYear() - birthDate.getFullYear();
                 const monthDifference = today.getMonth() - birthDate.getMonth();
                 if (monthDifference < 0 || (monthDifference === 0 && today.getDate() < birthDate.getDate())) {
                     calculatedAge--;
                 }
                 ageText = calculatedAge >= 0 ? `${calculatedAge} years old` : 'N/A';
                 userProfile.age = calculatedAge >= 0 ? calculatedAge : null;
             } catch(e) { console.error("Error calculating age:", e); }
        }


        // Safely update text content
        const updateText = (id, value) => {
            const element = document.getElementById(id);
            if (element) element.textContent = value || 'N/A';
        };

        updateText('profile-full-name', displayFullName); // Uses the corrected full name logic
        updateText('profile-age', ageText); 
        updateText('profile-address', userProfile.address);
        updateText('profile-contact', userProfile.phone);

        // Update form inputs
        const updateInput = (id, value) => {
            const element = document.getElementById(id);
            if (element) element.value = value || '';
        };

        updateInput('profile-username', userProfile.username);
        updateInput('profile-email', userProfile.email);
        updateInput('profile-phone', userProfile.phone);

        // --- 3. Fix Editable Username ---
        // Ensure username IS editable (removed the disabled = true logic)
        const usernameInput = document.getElementById('profile-username');
        if (usernameInput) {
            usernameInput.disabled = false; // Explicitly enable it
        }
    }


    // --- Messages View Rendering ---
    function fetchPatientConversations() {
        const consultations = appointments.filter(app =>
            app.patientName === currentUsername &&
            (app.status === 'Completed' || app.status === 'Accepted') &&
            app.doctorName 
        );
        const doctors = {};
        consultations.forEach(app => {
            if (!doctors[app.doctorName]) {
                doctors[app.doctorName] = {
                    doctorName: app.doctorName,
                    specialty: app.specialty,
                    profilePicture: app.doctorProfilePic 
                };
            }
        });
        currentConversations = Object.values(doctors);
        renderDoctorConversationList(currentConversations);
    }

    function renderDoctorConversationList(doctors) {
        const listContainer = document.getElementById('doctor-conversations-list');
        if (!listContainer) return;
        listContainer.innerHTML = ''; 

        if (doctors.length === 0) {
            listContainer.innerHTML = '<p class="placeholder-text-center text-sm text-[var(--text-secondary)] m-auto">You have no past conversations.</p>';
            return;
        }

        const defaultDoctorAvatarPath = '/images/default-doctor-avatar.png';

        doctors.forEach(doctor => {
            const li = document.createElement('div');
            li.className = 'doctor-card'; 
            li.dataset.doctorUsername = doctor.doctorName;

            const avatarSrc = doctor.profilePicture || defaultDoctorAvatarPath;

            li.innerHTML = `
                <div class="doctor-avatar-container">
                    <img src="${avatarSrc}" alt="Doctor Avatar" class="w-12 h-12 rounded-full object-cover" onerror="this.onerror=null; this.src='${defaultDoctorAvatarPath}';">
                </div>
                <div class="doctor-info">
                    <h4 class="doctor-name text-base font-semibold text-[var(--text-primary)]">Dr. ${doctor.doctorName}</h4>
                    <p class="doctor-specialty text-sm text-[var(--text-secondary)]">${doctor.specialty || 'N/A'}</p>
                </div>`;
            listContainer.appendChild(li);
        });
        
        const storedSelectedDoctor = sessionStorage.getItem('selectedDoctorUsername');
        if (storedSelectedDoctor) {
            selectedDoctorUsername = storedSelectedDoctor;
            const activeDoctorCard = listContainer.querySelector(`[data-doctor-username="${selectedDoctorUsername}"]`);
            if (activeDoctorCard) {
                activeDoctorCard.classList.add('active');
                fetchAndRenderChatHistory(selectedDoctorUsername);
            } else {
                 selectedDoctorUsername = null;
                 sessionStorage.removeItem('selectedDoctorUsername');
            }
        }
    }

    // --- Chat History Rendering ---
    function fetchAndRenderChatHistory(doctorUsername) {
         const relevantAppointment = appointments
            .filter(app => app.doctorName === doctorUsername && app.patientName === currentUsername && (app.status === 'Accepted' || app.status === 'Completed'))
            .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))[0]; 

        if (relevantAppointment) {
            selectedConversationAppointmentId = relevantAppointment.id;
            console.log(`[Patient][Chat] Switched chat to Dr. ${doctorUsername}, using appointment ID: ${selectedConversationAppointmentId}`);
        } else {
            selectedConversationAppointmentId = null; 
            console.warn(`[Patient][Chat] No active or completed appointment found for Dr. ${doctorUsername}. Cannot determine appointment ID for sending messages.`);
        }
        
        const messagesHeader = document.getElementById('messages-header');
        if (messagesHeader) {
            messagesHeader.innerHTML = `<h3 class="m-0 text-lg font-semibold text-[var(--text-primary)]">Conversation with Dr. ${doctorUsername}</h3>`;
        }

        const messageListContainer = document.getElementById('message-list-container');
         if (messageListContainer) {
            messageListContainer.innerHTML = '<p class="placeholder-text-center m-auto text-sm text-[var(--text-secondary)]">Loading messages...</p>';
         }

         document.getElementById('patient-message-input-form').style.display = 'flex';

        socket.emit('patient:get:chat:history', { patientUsername: currentUsername, doctorUsername });
    }

    function appendMessageToChat(msg, patientUsername) {
        const messageListContainer = document.getElementById('message-list-container');
        if (!messageListContainer) return;

        const placeholder = messageListContainer.querySelector('.placeholder-text-center');
        if (placeholder) placeholder.remove();

        const messageDiv = document.createElement('div');
        const isSentByMe = msg.senderUsername === patientUsername;
        messageDiv.className = `message-item flex flex-col ${isSentByMe ? 'items-end' : 'items-start'}`;

        let contentHtml = '';
        if (msg.fileUrl) {
            const isImage = /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(msg.fileUrl);
            if (isImage) {
                 contentHtml = `<a href="${msg.fileUrl}" target="_blank" class="block max-w-[200px]"><img src="${msg.fileUrl}" alt="Shared image" class="rounded-lg object-contain"></a>`;
            } else {
                 const fileName = msg.fileUrl.split('/').pop();
                 contentHtml = `<a href="${msg.fileUrl}" target="_blank" download="${fileName}" class="chat-file-link flex items-center gap-2 text-inherit hover:underline">
                    <i class="fas fa-file-alt"></i> ${msg.message || fileName}
                </a>`;
            }
        } else {
            contentHtml = msg.message || ''; 
        }

        messageDiv.innerHTML = `
            <div class="message-bubble">${contentHtml}</div>
            <div class="message-timestamp text-xs mt-1 ${isSentByMe ? 'text-right' : 'text-left'} opacity-70">${new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
        `;
        messageListContainer.appendChild(messageDiv);

        messageListContainer.scrollTop = messageListContainer.scrollHeight;

        if (!isSentByMe && notificationSound) {
            notificationSound.play().catch(e => console.error("Audio play failed on receive:", e));
        }
    }


    function renderChatMessages(messages, patientUsername) {
        const messageListContainer = document.getElementById('message-list-container');
        if (!messageListContainer) return;
        messageListContainer.innerHTML = ''; 

        if (!messages || messages.length === 0) {
            messageListContainer.innerHTML = '<p class="placeholder-text-center text-sm text-[var(--text-secondary)] m-auto">No chat history. Say hello!</p>';
            return;
        }

        messages.forEach(msg => appendMessageToChat(msg, patientUsername));
    }

    // --- Utility Functions ---
    function setTomorrowAsMinDate(inputElementId) {
        const dateInput = document.getElementById(inputElementId);
        if (dateInput) {
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            dateInput.min = tomorrow.toISOString().split('T')[0];
        }
    }

    // --- Initial User Check ---
    const loggedInUser = localStorage.getItem('telemedicine_user');
    const role = localStorage.getItem('telemedicine_role');

    if (loggedInUser && role === 'Patient') {
        currentUsername = loggedInUser;
        currentUserFullName = localStorage.getItem('telemedicine_fullname') || currentUsername; 
        if (headerUsernameDisplay) {
            headerUsernameDisplay.textContent = currentUsername; 
        }
        document.getElementById('patient-name-banner').textContent = currentUserFullName; 
    } else {
        alert('You must be logged in as a Patient to view this page.');
        window.location.href = '/'; 
        return; 
    }
    document.body.classList.add('loaded'); 
    showView('dashboard'); 


    // --- Fetch Initial Data ---
    function fetchAllPatientData() {
        console.log(`[Patient][Fetch] Requesting all data for ${currentUsername}`);
        if (!currentUsername) return;
        socket.emit('get:all:appointments'); 
        socket.emit('patient:get:profile', { username: currentUsername });
        if (document.querySelector('.nav-link.active')?.dataset.view === 'messages' && selectedDoctorUsername) {
             fetchAndRenderChatHistory(selectedDoctorUsername);
        }
    }


    // --- Socket.IO Event Listeners ---
    socket.on('connect', () => {
        console.log(`[Patient][Socket] Connected: ${socket.id}. Identifying as user: ${currentUsername}`);
        socket.emit('user:online', { username: currentUsername }, (response) => {
            console.log('[Patient][Socket] user:online acknowledged by server:', response);
            if (response && response.success) {
                console.log('[Patient][Socket] User identified. Proceeding with initial data fetch.');
                fetchAllPatientData(); 
                clearInterval(refreshInterval); 
                refreshInterval = setInterval(fetchAllPatientData, 15000); 
            } else {
                console.error('[Patient][Socket] Failed to identify user...', response?.message);
                showNotification('Error connecting to user session. Please refresh.', true);
            }
        });
    });

    socket.on('disconnect', () => {
        console.warn('[Patient][Socket] Disconnected from server.');
        clearInterval(refreshInterval); 
        showNotification('Connection lost. Please log in again.', true);
        setTimeout(() => { window.location.href = '/'; }, 1500);
    });

    socket.on('appointments:refetch', () => {
        console.log('[Patient][Socket] Received appointments:refetch. Fetching data...');
        fetchAllPatientData();
    });

    socket.on('appointments:update', (data) => {
        console.log('[Patient][Socket] Received appointments:update');
        if (data && data.appointments) {
            
            const newAppointments = data.appointments;
            const oldAppointments = appointments; 

            newAppointments.forEach(newApp => {
                const oldApp = oldAppointments.find(app => app.id === newApp.id);
                if (oldApp) {
                    if (oldApp.status === 'Pending' && newApp.status === 'Accepted') {
                        showNotification(`Your appointment for "${newApp.subject}" has been accepted.`);
                    }
                    if (oldApp.status === 'Pending' && newApp.status === 'Rejected') {
                        showNotification(`Your appointment for "${newApp.subject}" was rejected.`, true);
                    }
                } 
            });


            appointments = newAppointments; 
            console.log(`[Patient] Updated global appointments array (count: ${appointments.length}):`, JSON.stringify(appointments));


            console.log("[Patient] Refreshing doctor conversation list based on new data...");
            fetchPatientConversations(); 

            renderDashboardAppointments(); 

            const currentView = document.querySelector('.view-container:not(.hidden)')?.id?.replace('-view', '');
            if (currentView === 'my-health') {
                console.log("[Patient] Also triggering renderConsultationHistory...");
                renderConsultationHistory();
            } 
            
            const callModal = document.getElementById('patient-call-details-modal');
            if (callModal && callModal.classList.contains('show')) {
                 const modalAppId = callModal.dataset.appointmentId;
                 const updatedAppointmentForModal = appointments.find(app => app.id == modalAppId);
                 if (updatedAppointmentForModal) {
                    updateCallModalStatus(updatedAppointmentForModal); 
                 }
            }
        } else {
            console.warn('[Patient][Socket] Received appointments:update without valid appointment data.');
        }
    });
     socket.on('patient:profile:data', (data) => {
         if(data) {
             userProfile = data;
             // Logic to determine full name for top banner
             let fullNameForBanner = data.fullName;
             if (!fullNameForBanner && data.firstName && data.lastName) {
                 fullNameForBanner = `${data.firstName} ${data.lastName}`;
             }
             currentUserFullName = fullNameForBanner || currentUsername; 
             
             document.getElementById('patient-name-banner').textContent = currentUserFullName;
             renderMyProfile(); 
         }
     });

     socket.on('patient:update:profile:success', (data) => { 
         showNotification('Profile updated successfully!');
         if (data && data.profile) {
             userProfile = data.profile;
             // Update global username if it changed
             if (data.profile.username && data.profile.username !== currentUsername) {
                 currentUsername = data.profile.username;
                 localStorage.setItem('telemedicine_user', currentUsername);
             }
             renderMyProfile();
         }
     });

    socket.on('patient:update:profile:error', (data) => { 
        showNotification(data.message, true);
        socket.emit('patient:get:profile', { username: currentUsername });
    });

    socket.on('patient:profile-picture:updated', (response) => {
         if (response.success) {
            showNotification('Profile picture updated successfully!');
            socket.emit('patient:get:profile', { username: currentUsername });
         } else {
            showNotification(response.message || 'Failed to update profile picture.', true);
             socket.emit('patient:get:profile', { username: currentUsername }); 
         }
    });

    socket.on('patient:password:changed', (response) => { 
        const updateBtn = document.getElementById('confirm-password-change-btn');
        if (updateBtn) {
            updateBtn.disabled = false;
            updateBtn.innerHTML = 'Update Password';
        }
        if (response.success) {
            showNotification('Password changed successfully!');
            closeModal(document.getElementById('change-password-modal'));
        } else {
            showNotification(response.message || 'Failed to change password.', true);
            const currentPassInput = document.getElementById('current-password');
              if(currentPassInput) {
                 currentPassInput.value = '';
                  currentPassInput.focus();
              }
        }
    });

    // --- Server-sent Notifications ---
    socket.on('notification', (data) => {
        if(data && data.message) showNotification(data.message);
        if (data.message.includes('appointment')) {
            socket.emit('get:all:appointments');
        }
    });

    socket.on('notification:reschedule-request', (data) => {
        console.log('[Patient][Socket] Received notification:reschedule-request:', data);
        if(data && data.message) showNotification(data.message);
        fetchAllPatientData(); 
    });


    socket.on('room:ready', (data) => {
        const updatedAppointment = data.appointment;
        if (!updatedAppointment) return;
        const index = appointments.findIndex(app => app.id == updatedAppointment.id);
        if (index !== -1) appointments[index] = updatedAppointment;
        else appointments.push(updatedAppointment);
        showNotification(`Your consultation with Dr. ${updatedAppointment.doctorName} is ready!`);
        const modal = document.getElementById('patient-call-details-modal');
        if (modal.classList.contains('show') && modal.dataset.appointmentId == updatedAppointment.id) {
            updateCallModalStatus(updatedAppointment);
        }
    });

    // --- Chat History & Real-time Messages ---
    socket.on('patient:chat:history', (data) => {
        if (data.doctorUsername === selectedDoctorUsername) {
            renderChatMessages(data.chatHistory || [], currentUsername); 
        }
    });

    socket.on('dashboard:message:received', (message) => {
         const isMessagesViewActive = document.querySelector('.nav-link.active')?.dataset.view === 'messages';
         if (message.senderUsername && isMessagesViewActive && message.senderUsername === selectedDoctorUsername) {
            appendMessageToChat(message, currentUsername);
         } else if (message.senderUsername && message.senderUsername !== currentUsername) {
             const senderDisplay = message.senderName ? `Dr. ${message.senderName}` : (message.senderUsername || 'Someone');
            showNotification(`New message from ${senderDisplay}`);
         }
    });

    // --- DOM Event Listeners Setup ---
    document.querySelectorAll('.sidebar-nav a[data-view], .dropdown-menu a[data-view]').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const view = e.target.closest('a').dataset.view;
            if (view) showView(view);
             const userMenu = document.getElementById('user-menu'); 
             if (userMenu && userMenu.classList.contains('show')) userMenu.classList.remove('show');
            if (sidebar && sidebar.classList.contains('is-open')) toggleSidebar();
        });
    });

    document.getElementById('requestAppointmentLink')?.addEventListener('click', (e) => {
        e.preventDefault();
        openModal('appointment-modal');
        if (sidebar && sidebar.classList.contains('is-open')) toggleSidebar();
    });

    document.addEventListener('click', e => {
        // Handle placeholder button click
        if (e.target.id === 'request-appt-from-placeholder-1' || e.target.closest('[data-modal="appointment-modal"]')) {
             if (e.target.closest('a') || e.target.closest('button')) { 
                openModal('appointment-modal');
             }
        }
        // Close user dropdown if clicking outside
        const userMenu = document.getElementById('user-menu');
        if (userMenu && userMenu.classList.contains('show') && !e.target.closest('#userDropdownToggle') && !e.target.closest('#user-menu')) {
            toggleUserDropdown();
        }
    });


    document.querySelectorAll('.modal-close-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            closeModal(e.target.closest('.modal-overlay'));
        });
    });

    document.querySelectorAll('.modal-overlay').forEach(overlay => {
         overlay.addEventListener('click', (e) => {
             if (e.target === overlay) {
                 closeModal(overlay);
             }
         });
    });

    document.getElementById('appointment-request-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const appointmentRequest = {
            patientName: currentUsername,
            specialty: document.getElementById('appointment-expertise').value,
            appointmentDate: document.getElementById('appointment-date').value,
            appointmentTime: document.getElementById('appointment-time').value,
            subject: document.getElementById('appointment-reason').value,
        };
        if (!appointmentRequest.specialty || !appointmentRequest.appointmentDate || !appointmentRequest.appointmentTime || !appointmentRequest.subject) {
             showNotification("Please fill in all appointment details.", true);
             return;
        }
        console.log('[Patient] Submitting request:', appointmentRequest);
        socket.emit('appointment:request', appointmentRequest);
        showNotification('Request sent!');
        closeModal(document.getElementById('appointment-modal'));
    });

    document.getElementById('dashboard-view')?.addEventListener('click', (e) => {
         const respondBtn = e.target.closest('.respond-reschedule-btn');
         if (respondBtn) {
            const appointmentId = respondBtn.dataset.appointmentId;
            const appointment = appointments.find(app => app.id == appointmentId);
            if (appointment) openRescheduleResponseModal(appointment);
            return;
         }
         const cancelBtn = e.target.closest('.cancel-request-btn');
         if (cancelBtn) {
            const card = cancelBtn.closest('.visit-item');
            const appointmentIdToCancel = card?.dataset?.appointmentId;
            if (appointmentIdToCancel && confirm('Are you sure you want to cancel this request?')) {
                 card.classList.add('animate-throw-away');
                 setTimeout(() => card.remove(), 500);
                socket.emit('patient:cancel-request', { appointmentId: appointmentIdToCancel, patientUsername: currentUsername });
                showNotification('Request canceled.');
            }
            return;
         }
    });

    document.getElementById('upcoming-appointments-list')?.addEventListener('click', (e) => {
        const card = e.target.closest('.visit-item');
        if (card) {
            const appointmentId = card.dataset.appointmentId;
            const appointment = appointments.find(app => app.id == appointmentId);
            if (appointment) showPatientCallDetailsModal(appointment);
        }
    });

    document.getElementById('consultation-history-list')?.addEventListener('click', (e) => {
        const viewNotesBtn = e.target.closest('.view-notes-btn');
        if (viewNotesBtn) {
            const card = viewNotesBtn.closest('.consultation-card');
            const appointmentId = card.dataset.appointmentId;
            const appointment = appointments.find(app => app.id == appointmentId);
            if (appointment) showAppointmentNotesModal(appointment);
        }
    });

    document.getElementById('doctor-conversations-list')?.addEventListener('click', (e) => {
        const conversationItem = e.target.closest('.doctor-card');
        if (conversationItem) {
            const doctorUsername = conversationItem.dataset.doctorUsername;
            if (doctorUsername) {
                document.querySelectorAll('.doctor-card').forEach(item => item.classList.remove('active'));
                conversationItem.classList.add('active');
                selectedDoctorUsername = doctorUsername;
                sessionStorage.setItem('selectedDoctorUsername', selectedDoctorUsername);
                fetchAndRenderChatHistory(doctorUsername);
            }
        }
    });

    document.getElementById('logoutBtn')?.addEventListener('click', (e) => {
        e.preventDefault();
        clearInterval(refreshInterval);
        localStorage.clear();
        sessionStorage.clear();
        window.location.href = '/';
    });

    if(helpToggleBtn) helpToggleBtn.addEventListener('click', (e) => { e.preventDefault(); openModal('help-modal'); });
    document.getElementById('change-password-btn')?.addEventListener('click', () => { openModal('change-password-modal'); });
    document.getElementById('accept-reschedule-btn')?.addEventListener('click', () => {
        if (selectedAppointmentForReschedule) {
            socket.emit('patient:accept-reschedule', { appointmentId: selectedAppointmentForReschedule.id });
            showNotification('Reschedule accepted.');
            closeModal(document.getElementById('reschedule-response-modal'));
            selectedAppointmentForReschedule = null; 
        }
    });

    document.getElementById('reject-reschedule-btn')?.addEventListener('click', () => {
        if (selectedAppointmentForReschedule && confirm('Rejecting this will cancel the appointment. Are you sure?')) {
            socket.emit('patient:reject-reschedule', {
                appointmentId: selectedAppointmentForReschedule.id,
                patientUsername: currentUsername
            });
            showNotification('Reschedule rejected.', true);
            closeModal(document.getElementById('reschedule-response-modal'));
            selectedAppointmentForReschedule = null; 
        }
    });

    document.getElementById('propose-new-time-btn')?.addEventListener('click', () => {
        if (selectedAppointmentForReschedule) {
            closeModal(document.getElementById('reschedule-response-modal'));
            openModal('propose-new-time-modal');
            setTomorrowAsMinDate('propose-date');
        }
    });

    document.getElementById('edit-profile-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const updatedProfile = {
            username: document.getElementById('profile-username').value, // Now sends the new username
            email: document.getElementById('profile-email').value,
            phone: document.getElementById('profile-phone').value,
            originalUsername: currentUsername // To identify the user if username changes (depends on backend logic)
        };
        if (!updatedProfile.email) {
            showNotification('Email cannot be empty.', true);
            return;
        }
        socket.emit('patient:update:profile', updatedProfile);
        showNotification('Saving profile changes...');
    });

    document.getElementById('change-password-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const currentPassword = document.getElementById('current-password').value;
        const newPassword = document.getElementById('new-password').value;
        const confirmNewPassword = document.getElementById('confirm-new-password').value;
        if (!currentPassword || !newPassword || !confirmNewPassword) { showNotification('Please fill all fields.', true); return; }
        if (newPassword.length < 8) { showNotification('New password too short.', true); return; }
        if (newPassword !== confirmNewPassword) { showNotification('New passwords don\'t match.', true); return; }
        socket.emit('patient:change:password', { username: currentUsername, currentPassword, newPassword });
    });

    document.getElementById('propose-new-time-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        if (selectedAppointmentForReschedule) {
            const newDate = document.getElementById('propose-date').value;
            const newTime = document.getElementById('propose-time').value;
            if (!newDate || !newTime) { alert('Please select date and time.'); return; }
            socket.emit('patient:propose:new-time', {
                appointmentId: selectedAppointmentForReschedule.id,
                newDate,
                newTime,
                patientUsername: currentUsername
            });
            showNotification('New time proposed.');
            closeModal(document.getElementById('propose-new-time-modal'));
            selectedAppointmentForReschedule = null;
        }
    });

    document.getElementById('patient-message-input-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const messageInput = document.getElementById('patient-message-input');
        const message = messageInput.value.trim();
        if (message && selectedDoctorUsername && selectedConversationAppointmentId) {
            const tempMessage = { senderUsername: currentUsername, message, timestamp: new Date().toISOString() };
            appendMessageToChat(tempMessage, currentUsername);
            socket.emit('dashboard:send:message', {
                senderUsername: currentUsername,
                receiverUsername: selectedDoctorUsername,
                message: message,
                senderFullName: currentUserFullName,
                appointmentId: selectedConversationAppointmentId 
            });
            messageInput.value = '';
            messageInput.focus();
        } else if (!selectedConversationAppointmentId) {
             showNotification("Cannot send message. No active or completed appointment found for this doctor.", true);
        }
    });

    const profilePicUploader = document.getElementById('profile-picture-uploader');
    const profilePicInput = document.getElementById('profile-picture-input');
    if (profilePicUploader && profilePicInput) {
        profilePicUploader.addEventListener('click', () => profilePicInput.click());
        profilePicInput.addEventListener('change', (event) => {
            const file = event.target.files[0];
            if (file) {
                if (!file.type.startsWith('image/')) { showNotification('Invalid file type.', true); return; }
                if (file.size > 2 * 1024 * 1024) { showNotification('File too large (Max 2MB).', true); return; }
                const reader = new FileReader();
                reader.onload = function(e) {
                    socket.emit('patient:update:profile-picture', {
                        username: currentUsername,
                        imageData: e.target.result
                    });
                };
                reader.readAsDataURL(file);
            }
            event.target.value = null; 
        });
    }

    document.getElementById('downloadSummaryBtn')?.addEventListener('click', () => {
        const doctorName = document.getElementById('notes-modal-doctor-name').textContent;
        const specialty = document.getElementById('notes-modal-specialty').textContent;
        const date = document.getElementById('notes-modal-date').textContent;
        const notes = document.getElementById('notes-modal-notes').textContent;
        const summaryText = `Consultation Summary\n\nDoctor: ${doctorName}\nSpecialty: ${specialty}\nDate: ${date}\n\nDoctor's Notes:\n${notes}`;
        const blob = new Blob([summaryText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const safeDate = date.replace(/[^a-zA-Z0-9]/g, '_');
        a.download = `Consultation_Summary_${safeDate}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });
    // --- End DOM Listeners ---

    // --- Initial Setup Calls ---
    setTomorrowAsMinDate('appointment-date');
    setTomorrowAsMinDate('propose-date');
});