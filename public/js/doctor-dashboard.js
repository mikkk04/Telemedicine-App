'use strict'; // Added strict mode for better code quality and error prevention

let currentUsername = '';
let currentRole = '';
let allAppointments = [];
let doctorProfile = {};
let staticFullName = ''; // To store the full name separately for display
let selectedDate = new Date().toISOString().slice(0, 10); // Initialize with today's date
let currentPatients = [];
let selectedPatient = null; // Store the patient object for the active chat
let selectedAppointmentIdForChat = null;
let rejectionAppointmentId = null; // Store ID for rejection modal
let calendarDate = new Date(); // Date object for calendar navigation

const socket = io();

// Diagnosis data structure
const diagnosisData = {
    "Infectious Diseases": ["Common Cold", "Influenza (Flu)", "Pneumonia", "Tuberculosis", "COVID-19"],
    "Cardiovascular Diseases": ["Hypertension", "Coronary Artery Disease", "Heart Failure", "Stroke"],
    "Metabolic Disorders": ["Type 1 Diabetes", "Type 2 Diabetes", "Obesity", "Metabolic Syndrome"],
    "Respiratory Diseases": ["Asthma", "Chronic Obstructive Pulmonary Disease (COPD)", "Bronchitis"],
    "Gastrointestinal Disorders": ["Gastroesophageal Reflux Disease (GERD)", "Irritable Bowel Syndrome (IBS)", "Gastroenteritis"],
    "Musculoskeletal Disorders": ["Osteoarthritis", "Rheumatoid Arthritis", "Back Pain", "Osteoporosis"],
    "Neurological Disorders": ["Migraine", "Epilepsy", "Alzheimer's Disease", "Parkinson's Disease"],
    "Mental Health": ["Depression", "Anxiety Disorder", "Bipolar Disorder", "Schizophrenia"]
};

// Global listeners to manage event binding/unbinding
let diagnosisTypeChangeListener = null;
let diagnosisSpecificChangeListener = null;

// Notification sound
const notificationSound = new Audio('/sounds/notification.mp3'); // Ensure path is correct

function playNotificationSound() {
    notificationSound.play().catch(e => console.error("Error playing notification sound:", e));
}

// --- DIAGNOSIS HELPER FUNCTIONS ---
function updateDiagnosisTextarea() {
    const typeSelect = document.getElementById('diagnosis-type-select');
    const specificSelect = document.getElementById('diagnosis-specific-select');
    const doctorNotesTextarea = document.getElementById('doctorNotes');
    if (!typeSelect || !specificSelect || !doctorNotesTextarea) return;

    const type = typeSelect.value;
    const specific = specificSelect.value;

    const currentNotes = doctorNotesTextarea.value;
    const notesMarker = "--- Additional Notes ---";
    let additionalNotes = "";
    const markerIndex = currentNotes.indexOf(notesMarker);
    if (markerIndex !== -1) {
        additionalNotes = currentNotes.substring(markerIndex + notesMarker.length).trim();
    } else if (!currentNotes.startsWith("Diagnosis Type:") && !currentNotes.startsWith("Specific Diagnosis:")) {
        additionalNotes = currentNotes.trim();
    }

    let diagnosisText = "";
    if (type) diagnosisText += `Diagnosis Type: ${type}\n`;
    if (specific) diagnosisText += `Specific Diagnosis: ${specific}\n`;

    if (diagnosisText) {
        doctorNotesTextarea.value = diagnosisText + `\n${notesMarker}\n${additionalNotes}`;
    } else {
        doctorNotesTextarea.value = `\n${notesMarker}\n${additionalNotes}`;
    }

    // Set cursor to end after update
    doctorNotesTextarea.focus();
    const endPosition = doctorNotesTextarea.value.length;
    doctorNotesTextarea.setSelectionRange(endPosition, endPosition);
    doctorNotesTextarea.scrollTop = doctorNotesTextarea.scrollHeight; // Scroll to bottom if needed
}
function setupDiagnosisSelectors(isNewDiagnosis = false) {
    const typeSelect = document.getElementById('diagnosis-type-select');
    const specificSelect = document.getElementById('diagnosis-specific-select');
    if (!typeSelect || !specificSelect) { console.error("Diagnosis select elements not found."); return; }

    // Populate Type Select
    typeSelect.innerHTML = `<option value="">-- Select Type --</option>`;
    for (const type in diagnosisData) {
        typeSelect.innerHTML += `<option value="${type}">${type}</option>`;
    }
    // Reset Specific Select
    specificSelect.innerHTML = `<option value="">-- Select Diagnosis --</option>`;
    specificSelect.disabled = true;

    // Remove previous listeners if they exist
    if (diagnosisTypeChangeListener) typeSelect.removeEventListener('change', diagnosisTypeChangeListener);
    if (diagnosisSpecificChangeListener) specificSelect.removeEventListener('change', diagnosisSpecificChangeListener);

    // Add listener for Type change
    diagnosisTypeChangeListener = () => {
        const selectedType = typeSelect.value;
        specificSelect.innerHTML = `<option value="">-- Select Diagnosis --</option>`; // Reset
        if (selectedType && diagnosisData[selectedType]) {
            diagnosisData[selectedType].forEach(diagnosis => {
                specificSelect.innerHTML += `<option value="${diagnosis}">${diagnosis}</option>`;
            });
            specificSelect.disabled = false;
        } else {
            specificSelect.disabled = true;
        }
        // If setting up for a new diagnosis, update text area when type changes
        if (isNewDiagnosis) updateDiagnosisTextarea();
    };
    typeSelect.addEventListener('change', diagnosisTypeChangeListener);

    // Only add listener to Specific select if it's for a new diagnosis (to update textarea)
    if (isNewDiagnosis) {
        diagnosisSpecificChangeListener = updateDiagnosisTextarea;
        specificSelect.addEventListener('change', diagnosisSpecificChangeListener);
    }
}
function populateSelectorsFromNotes(notes) {
    if (!notes) return;
    const typeSelect = document.getElementById('diagnosis-type-select');
    const specificSelect = document.getElementById('diagnosis-specific-select');
    if (!typeSelect || !specificSelect) return;

    const typeRegex = /Diagnosis Type: (.*)/;
    const specificRegex = /Specific Diagnosis: (.*)/;
    const typeMatch = notes.match(typeRegex);
    const specificMatch = notes.match(specificRegex); // Match specific diagnosis too

    if (typeMatch && typeMatch[1]) {
        const type = typeMatch[1].trim();
        if (diagnosisData.hasOwnProperty(type)) { // Check if type exists in our data
            typeSelect.value = type;
            // Manually trigger the population of the specific select
            specificSelect.innerHTML = `<option value="">-- Select Diagnosis --</option>`;
            diagnosisData[type].forEach(diagnosis => {
                specificSelect.innerHTML += `<option value="${diagnosis}">${diagnosis}</option>`;
            });
            specificSelect.disabled = false;

            // Now try to select the specific diagnosis if it was found
            if (specificMatch && specificMatch[1]) {
                const specific = specificMatch[1].trim();
                // Check if the extracted specific diagnosis is valid for the selected type
                const optionExists = Array.from(specificSelect.options).some(opt => opt.value === specific);
                if (optionExists) {
                    specificSelect.value = specific;
                } else {
                     console.warn(`Specific diagnosis "${specific}" from notes not found in options for type "${type}".`);
                }
            }
        } else {
            console.warn(`Diagnosis type "${type}" from notes not found in diagnosisData.`);
            specificSelect.disabled = true; // Disable if type is invalid
        }
    } else {
         // If no type match, ensure specific is disabled
         specificSelect.disabled = true;
    }
}
// --- END DIAGNOSIS HELPERS ---


// --- MODAL & UI HELPERS ---
function showModal(modalId) { const modal = document.getElementById(modalId); if (modal) { modal.classList.remove('hidden'); modal.classList.add('flex'); } }
function hideModal(modalId) { const modal = document.getElementById(modalId); if (modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); const form = modal.querySelector('form'); if (form) form.reset(); const passwordError = modal.querySelector('#password-error'); if (passwordError) { passwordError.classList.add('hidden'); passwordError.textContent = ''; } } }
function setupModalCloseButtons() { document.querySelectorAll('.close-btn').forEach(btn => btn.addEventListener('click', () => { const modal = btn.closest('.modal-overlay'); if (modal) hideModal(modal.id); })); }
function showRescheduleModal(appointment) {
    const modal = document.getElementById('reschedule-modal'); if (!modal) return;
    document.getElementById('resched-patient-name').textContent = appointment.patientFullName || appointment.patientName || 'N/A';
    document.getElementById('resched-subject').textContent = appointment.subject || 'N/A';
    document.getElementById('resched-appointment-id').value = appointment.id;
    let currentDateTime;
    if (appointment.appointmentDate && appointment.appointmentTime) { const datePart = appointment.appointmentDate.split('T')[0]; currentDateTime = new Date(`${datePart}T${appointment.appointmentTime}`); }
    if (currentDateTime && !isNaN(currentDateTime)) { document.getElementById('resched-current-datetime').textContent = currentDateTime.toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' }); } else { document.getElementById('resched-current-datetime').textContent = 'Date/Time not specified'; console.warn('Could not parse appointment date/time for reschedule modal:', appointment); }
    document.getElementById('resched-date').min = new Date().toISOString().split('T')[0]; // Set min date to today
    document.getElementById('resched-date').value = ''; // Clear previous value
    const timeSelect = document.getElementById('resched-time'); timeSelect.innerHTML = '<option value="" disabled selected>Select a time</option>';
    const availableTimes = []; for (let i = 8; i < 12; i++) { availableTimes.push(`${i.toString().padStart(2, '0')}:00:00`); availableTimes.push(`${i.toString().padStart(2, '0')}:30:00`); } for (let i = 13; i < 17; i++) { availableTimes.push(`${i.toString().padStart(2, '0')}:00:00`); availableTimes.push(`${i.toString().padStart(2, '0')}:30:00`); }
    availableTimes.forEach(time24 => { const [hour, minute] = time24.split(':'); const hourInt = parseInt(hour, 10); const ampm = hourInt >= 12 ? 'PM' : 'AM'; const hour12 = hourInt % 12 || 12; const time12 = `${hour12}:${minute} ${ampm}`; const option = document.createElement('option'); option.value = time24; option.textContent = time12; timeSelect.appendChild(option); });
    document.getElementById('resched-reason').value = ''; // Clear previous reason
    showModal('reschedule-modal');
}
/**
 * Renders the Call Details Modal.
 * @param {object} appointment The appointment object.
 */
function showCallDetailsModal(appointment, serverRedirectUrl = null) {
    const callPatientNameEl = document.getElementById('callPatientName');
    const createJoinBtn = document.getElementById('createJoinCallBtn');
    const callLinkEl = document.getElementById('callLinkText');
    const qrCodeEl = document.getElementById('qrCodeImage');

    callPatientNameEl.textContent = appointment.patientFullName || appointment.patientName;
    createJoinBtn.dataset.appointmentId = appointment.id;
    document.getElementById('finishAppointmentBtn').dataset.appointmentId = appointment.id;

    let fullUrl = '#';

    // 1. Construct the absolute URL
    // We must ensure we are creating a valid URL structure: domain + /call/ID + query params
    if (serverRedirectUrl) {
        // If server sent a redirect URL (e.g. /call/123?token=...), make it absolute
        fullUrl = serverRedirectUrl.startsWith('http') ? serverRedirectUrl : `${window.location.origin}${serverRedirectUrl}`;
    } else if (appointment.authToken) {
        // If we only have the token string, construct the URL manually
        fullUrl = `${window.location.origin}/call/${appointment.id}?token=${appointment.authToken}`;
    }

    console.log('[Call Modal] Constructed URL:', fullUrl);

    // 2. Apply URL to Link & QR
    if (fullUrl !== '#') {
        callLinkEl.href = fullUrl;
        callLinkEl.textContent = fullUrl;
        
        // 3. Apply URL to QR Code
        setTimeout(() => {
            if (typeof QRCode !== 'undefined') {
                qrCodeEl.src = ''; 
                QRCode.toDataURL(fullUrl, { width: 200, margin: 2 }, (err, url) => {
                    if(!err) qrCodeEl.src = url;
                });
            }
        }, 50);
    } else {
        callLinkEl.href = '#';
        callLinkEl.textContent = 'Link generating...';
        qrCodeEl.src = '';
    }

    // 4. Apply URL to Button (Join Mode)
    // If room exists OR we just got a redirect URL, show JOIN and set onclick
    if (appointment.roomCreated || serverRedirectUrl) {
        createJoinBtn.textContent = 'Join Call';
        createJoinBtn.disabled = false;
        createJoinBtn.onclick = (e) => {
            e.preventDefault(); 
            e.stopPropagation();
            console.log('[Join Call] Opening URL:', fullUrl);
            window.open(fullUrl, '_blank'); 
        };
    } else {
        createJoinBtn.textContent = 'Create Call';
        createJoinBtn.disabled = false;
        createJoinBtn.onclick = null; // Handled by global event listener
    }

    showModal('callDetailsModal');
}
// --- END MODAL & UI HELPERS ---

// --- CALENDAR FUNCTIONS ---
function getCalendarEventColor(status) { switch (status) { case 'Pending': return 'var(--ui-warning)'; case 'Accepted': return 'var(--primary-color)'; case 'Rescheduled-Pending': return 'var(--ui-warning)'; case 'Completed': return 'var(--ui-success)'; case 'Rejected': return 'var(--ui-danger)'; default: return 'var(--primary-color)'; } }
function renderCalendar() {
    const calendarMonthYear = document.getElementById('calendar-month-year'); const calendarGrid = document.getElementById('calendar-grid'); if (!calendarMonthYear || !calendarGrid) return;
    const month = calendarDate.getMonth(); const year = calendarDate.getFullYear(); const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]; calendarMonthYear.textContent = `${monthNames[month]} ${year}`;
    const firstDayOfMonth = new Date(year, month, 1); const daysInMonth = new Date(year, month + 1, 0).getDate(); const startingDayOfWeek = firstDayOfMonth.getDay(); calendarGrid.innerHTML = '';
    for (let i = 0; i < startingDayOfWeek; i++) calendarGrid.innerHTML += `<div></div>`; // Blank days at start
    const visibleAppointments = allAppointments.filter(app => (app.status === 'Accepted' || app.status === 'Pending' || app.status === 'Rescheduled-Pending') && app.doctorName === currentUsername); const appointmentsByDay = {};
    visibleAppointments.forEach(app => { const appDate = new Date(app.appointmentDate.split('T')[0] + 'T00:00:00'); if (appDate.getFullYear() === year && appDate.getMonth() === month) { const day = appDate.getDate(); if (!appointmentsByDay[day]) appointmentsByDay[day] = []; appointmentsByDay[day].push(app); } });
    for (let day = 1; day <= daysInMonth; day++) { const today = new Date(); const isToday = day === today.getDate() && month === today.getMonth() && year === today.getFullYear(); const hasAppointments = appointmentsByDay[day] && appointmentsByDay[day].length > 0; const dataDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        let dayCellHtml = `<div class="day-cell flex flex-col items-center justify-start p-2 min-h-[100px] ${hasAppointments ? 'cursor-pointer hover:bg-[rgba(var(--primary-rgb),0.1)]' : ''}" data-date="${dataDate}" ${hasAppointments ? 'data-has-appointments="true"' : ''}>`; dayCellHtml += `<div class="day-number w-8 h-8 flex items-center justify-center rounded-full ${isToday ? 'today' : ''}">${day}</div>`;
        if (hasAppointments) { dayCellHtml += '<div class="appointments-summary flex flex-wrap justify-center gap-1 mt-1">'; appointmentsByDay[day].slice(0, 4).forEach(app => { const dotColor = getCalendarEventColor(app.status); dayCellHtml += `<div class="w-2 h-2 rounded-full" style="background-color: ${dotColor};" title="${app.patientFullName || app.patientName} (${app.status})"></div>`; }); if (appointmentsByDay[day].length > 4) dayCellHtml += '<span class="text-xs text-[var(--text-secondary)]">...</span>'; dayCellHtml += '</div>'; } dayCellHtml += `</div>`; calendarGrid.innerHTML += dayCellHtml;
    }
}

// -------------------
// --- FIX APPLIED ---
// -------------------
function setupCalendarEventListeners() {
    const calendarContainer = document.getElementById('calendar-view'); if (!calendarContainer) return;
    const listEl = document.getElementById('modal-appointments-list'); // Get the list element once

    // Calendar Day/Month Click Logic
    calendarContainer.addEventListener('click', e => {
        if (e.target.closest('#prev-month-btn')) { calendarDate.setMonth(calendarDate.getMonth() - 1); renderCalendar(); }
        if (e.target.closest('#next-month-btn')) { calendarDate.setMonth(calendarDate.getMonth() + 1); renderCalendar(); }

        const dayCell = e.target.closest('.day-cell[data-has-appointments="true"]');
        if (dayCell) {
            const dateStr = dayCell.dataset.date;
            const targetDate = new Date(dateStr + 'T00:00:00');
            const appointments = allAppointments.filter(app => {
                const appDate = new Date(app.appointmentDate.split('T')[0] + 'T00:00:00');
                const relevantStatus = app.status === 'Accepted' || app.status === 'Pending' || app.status === 'Rescheduled-Pending';
                return relevantStatus && app.doctorName === currentUsername && appDate.getTime() === targetDate.getTime();
            }).sort((a,b) => a.appointmentTime.localeCompare(b.appointmentTime));

            document.getElementById('modal-date-header').textContent = targetDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
            
            // Ensure listEl exists before modifying innerHTML
            if (!listEl) {
                 console.error("Could not find 'modal-appointments-list' element!");
                 return; 
            }
            listEl.innerHTML = ''; // Clear previous list

            if (appointments.length > 0) {
                appointments.forEach(app => {
                    const li = document.createElement('li');
                    li.className = "card !p-4 flex justify-between items-center";
                    // Store the full appointment data safely on the button
                    let appDataString = '{}';
                    try {
                        // Use encodeURIComponent for safety, wrap attribute value in single quotes
                        appDataString = `'${encodeURIComponent(JSON.stringify(app))}'`; 
                    } catch (stringifyErr) {
                        console.error("Error stringifying appointment data for button:", stringifyErr, app);
                    }
                    li.innerHTML = `
                        <div>
                            <p class="font-bold">${app.appointmentTime} - ${app.patientFullName || app.patientName}</p>
                            <span class="text-sm text-[var(--text-secondary)]">Subject: ${app.subject}</span>
                        </div>
                        <button class="action-btn primary reschedule-btn" data-appointment=${appDataString}>Reschedule</button>`; 
                    listEl.appendChild(li);
                });
            } else {
                listEl.innerHTML = '<li>No relevant appointments for this day.</li>';
            }
            showModal('calendar-day-modal');
        }
    });

    // Event listener for clicks *inside* the calendar day modal's list
    if (listEl) {
        listEl.addEventListener('click', (e) => {
            const rescheduleButton = e.target.closest('.reschedule-btn');
            // Check if a reschedule button was clicked AND it has the appointment data
            if (rescheduleButton && rescheduleButton.dataset.appointment) {
                try {
                    // Decode and parse the appointment data stored on the button
                    const appData = JSON.parse(decodeURIComponent(rescheduleButton.dataset.appointment)); // Decode before parsing
                    if (appData && typeof appData === 'object') { // Basic check if data is valid
                        
                        console.log("[Calendar Modal Reschedule Click] Hiding calendar-day-modal and showing reschedule modal for:", appData);
                        hideModal('calendar-day-modal'); // ** Hide the current modal **
                        showRescheduleModal(appData);    // ** Show the reschedule modal **
                    } else {
                         console.warn("Reschedule button clicked, but parsed data was invalid or empty.", appData);
                         alert("Could not open reschedule modal. Appointment data seems corrupted.");
                    }
                } catch (err) {
                    console.error("Error parsing appointment data for reschedule:", err, rescheduleButton.dataset.appointment);
                    alert("Could not open reschedule modal. Invalid data format.");
                }
            } else if (rescheduleButton) {
                 console.warn("Reschedule button clicked, but data-appointment attribute was missing or empty.");
                 alert("Could not open reschedule modal. Appointment data attribute missing.");
            }
        });
    } else {
         console.error("Could not find the appointment list element ('modal-appointments-list') to attach listener.");
    }

    // Reschedule form submission logic (remains the same)
    const rescheduleForm = document.getElementById('reschedule-form');
    if (rescheduleForm) {
        rescheduleForm.addEventListener('submit', e => {
            e.preventDefault();
            const appointmentId = document.getElementById('resched-appointment-id').value;
            const newDate = document.getElementById('resched-date').value;
            const newTime = document.getElementById('resched-time').value;
            const reason = document.getElementById('resched-reason').value;
            if (!newDate || !newTime) {
                alert('Please select a new date and time.');
                return;
            }
            socket.emit('appointment:reschedule', { appointmentId, newDate, newTime, reason, doctorName: currentUsername });
            hideModal('reschedule-modal');
            rescheduleForm.reset();
        });
    }
}
// -------------------
// --- END OF FIX ---
// -------------------
// --- END CALENDAR FUNCTIONS ---


// --- GENERAL HELPER FUNCTIONS ---
function getLoggedInUser() { return { username: localStorage.getItem('telemedicine_user'), role: localStorage.getItem('telemedicine_role'), fullName: localStorage.getItem('telemedicine_fullname') }; }
function showView(viewName) { const views = ['dashboard', 'appointments', 'profile', 'messages', 'calendar']; views.forEach(view => { const el = document.getElementById(`${view}-view`); if (el) el.classList.add('hidden'); }); const activeView = document.getElementById(`${viewName}-view`); if (activeView) activeView.classList.remove('hidden'); document.querySelectorAll('.sidebar-nav a').forEach(link => link.classList.remove('active')); const activeLink = document.querySelector(`.nav-link[data-view="${viewName}"]`); if (activeLink) activeLink.classList.add('active'); if (viewName === 'appointments') renderAllAppointments(); else if (viewName === 'profile') renderProfile(); else if (viewName === 'messages') renderMessagesView(); else if (viewName === 'calendar') renderCalendar(); }
function updateNotificationBadge(count) { const badge = document.getElementById('notification-badge'); if (badge) { if (count > 0) { badge.textContent = count; badge.classList.remove('hidden'); badge.classList.add('flex'); } else { badge.classList.add('hidden'); badge.classList.remove('flex'); } } }
function hasConflict(appointmentDate, appointmentTime) { const targetDateStr = appointmentDate.split('T')[0]; return allAppointments.some(app => app.doctorName === currentUsername && app.status === 'Accepted' && app.appointmentDate.split('T')[0] === targetDateStr && app.appointmentTime === appointmentTime); }
function calculateAge(birthdate) { if (!birthdate) return 'N/A'; try { const today = new Date(); const birthDate = new Date(birthdate); if (isNaN(birthDate.getTime())) return 'N/A'; let age = today.getFullYear() - birthDate.getFullYear(); const m = today.getMonth() - birthDate.getMonth(); if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--; return age; } catch (e) { console.error("Error calculating age:", e); return 'N/A'; } }
function copyToken(token, event) { 
    event.preventDefault(); 
    if (!token || token === '#') { // Prevent copying placeholder
        alert("No link available to copy yet.");
        return;
    }
    navigator.clipboard.writeText(token).then(() => { 
        const button = event.target.closest('.copy-btn'); if (!button) return; 
        const originalIcon = button.innerHTML; 
        button.innerHTML = '<i class="fas fa-check text-green-500"></i>'; 
        button.disabled = true; // Briefly disable after copy
        setTimeout(() => { 
            button.innerHTML = originalIcon; 
            button.disabled = false;
        }, 2000); 
    }).catch(err => { 
        console.error('Failed to copy text: ', err); 
        alert('Failed to copy link automatically. Please copy it manually.'); 
    }); 
}
// --- END GENERAL HELPERS ---


// --- DASHBOARD RENDERING FUNCTIONS ---
function renderDashboard() {
    const today = new Date().toISOString().slice(0, 10);
    const myAppointments = allAppointments.filter(app => app.doctorName === currentUsername);
    const pendingRequests = allAppointments.filter(app => app.status === 'Pending' && app.specialty === doctorProfile.specialty); // Filter requests by specialty
    const completedAppointmentsCount = myAppointments.filter(app => app.status === 'Completed').length;
    const totalMyAppointmentsCount = myAppointments.length;
    
    // Use try-catch for DOM updates as elements might be missing
    try {
        document.getElementById('totalAppointmentsCount').textContent = totalMyAppointmentsCount;
        document.getElementById('pendingAppointmentsCount').textContent = pendingRequests.length;
        document.getElementById('completedAppointmentsCount').textContent = completedAppointmentsCount;
    } catch (e) {
        console.error("Error updating dashboard counts:", e);
    }
    
    updateNotificationBadge(pendingRequests.length);
    renderTodaysAppointments(today);
    renderAppointmentRequests(); // Uses pendingRequests filtered above
}
function createAppointmentItemHTML(req) {
     const profilePicSrc = req.patientProfilePic || `https://ui-avatars.com/api/?name=${encodeURIComponent(req.patientFullName || req.patientName || 'P')}&background=E1E1E1&color=555&bold=true`;
    return `
        <li class="card !p-3 flex items-center gap-4">
            <img src="${profilePicSrc}" alt="${req.patientFullName || req.patientName} image" class="w-12 h-12 rounded-full object-cover">
            <div class="details flex-grow min-w-0"> 
                <h4 class="font-semibold truncate">${req.patientFullName || req.patientName} (${req.specialty})</h4> 
                <p class="text-sm text-gray-500 truncate">Subject: ${req.subject}</p> 
                <p class="text-xs text-gray-400 truncate">Requested: ${new Date(req.appointmentDate).toLocaleDateString()} at ${req.appointmentTime}</p> 
            </div>
            <div class="actions flex gap-2 flex-shrink-0"> 
                <button class="action-btn accept-btn !p-0 w-9 h-9 flex items-center justify-center !rounded-full" data-id="${req.id}" title="Accept"><i class="fas fa-check"></i></button> 
                <button class="action-btn primary reschedule-btn !p-0 w-9 h-9 flex items-center justify-center !rounded-full" type="button" data-id="${req.id}" title="Reschedule"><i class="fas fa-calendar-alt"></i></button> 
                <button class="action-btn reject-btn !p-0 w-9 h-9 flex items-center justify-center !rounded-full" data-id="${req.id}" title="Reject"><i class="fas fa-times"></i></button> 
            </div>
        </li>`;
}
function renderAppointmentRequests() {
    const requestsListContainer = document.getElementById('requests-list-container'); 
    if (!requestsListContainer) { 
        console.error("Element 'requests-list-container' not found."); 
        return; 
    } 
    requestsListContainer.innerHTML = ''; // Clear previous
    
    const mySpecialty = doctorProfile.specialty;
    if (!mySpecialty) {
         console.warn("Doctor specialty not yet loaded. Cannot filter requests.");
         requestsListContainer.innerHTML = '<p class="text-center text-gray-500 py-4">Loading specialty...</p>';
         return;
    }
    
    const pendingRequests = allAppointments.filter(app => app.status === 'Pending' && app.specialty === mySpecialty);
    
    if (pendingRequests.length === 0) { 
        requestsListContainer.innerHTML = '<p class="text-center text-gray-500 py-4">No new requests for your specialty.</p>'; 
        return; 
    }
    
    pendingRequests.forEach(req => { 
        requestsListContainer.innerHTML += createAppointmentItemHTML(req); 
    });
}
function renderTodaysAppointments(date) {
    const todayAppointmentsList = document.getElementById('today-appointments-list'); 
    if (!todayAppointmentsList) {
         console.error("Element 'today-appointments-list' not found.");
         return; 
    }
    todayAppointmentsList.innerHTML = ''; // Clear previous
    
    const appointmentsOnDate = allAppointments.filter(app => 
        app.appointmentDate.startsWith(date) && 
        (app.status === 'Accepted' || app.status === 'Completed') && 
        app.doctorName === currentUsername
    ).sort((a, b) => a.appointmentTime.localeCompare(b.appointmentTime));
    
    if (appointmentsOnDate.length === 0) { 
        todayAppointmentsList.innerHTML = `<p class="text-center text-gray-500 py-4">No appointments scheduled for today.</p>`; 
        return; 
    }
    
    appointmentsOnDate.forEach(app => { 
        let actionsHtml = ''; 
        if (app.status === 'Accepted') { 
            actionsHtml = `<button class="action-btn primary view-details-btn !p-0 w-10 h-10 flex items-center justify-center !rounded-full" data-id="${app.id}" title="Start Call"><i class="fas fa-video"></i></button>`; 
        } else if (app.status === 'Completed') { 
            actionsHtml = `<button class="action-btn secondary view-details-btn !p-0 w-10 h-10 flex items-center justify-center !rounded-full" data-id="${app.id}" title="View Notes"><i class="fas fa-sticky-note"></i></button>`; 
        }
        todayAppointmentsList.innerHTML += `
            <li class="card !p-3 flex items-center gap-4"> 
                <div class="details flex-grow"> 
                    <h4 class="font-semibold">${app.patientFullName || app.patientName} - ${app.subject}</h4> 
                    <p class="text-sm text-[var(--text-secondary)]">${app.appointmentTime}</p> 
                    <p class="text-sm">Status: <span class="font-semibold" style="color: ${getCalendarEventColor(app.status)}">${app.status}</span></p> 
                </div> 
                <div class="actions">${actionsHtml}</div> 
            </li>`; 
    });
}
// --- END DASHBOARD RENDERING ---


// --- ALL APPOINTMENTS VIEW ---
function renderAllAppointments() {
    const pendingList = document.getElementById('pending-appointments-list'); 
    const acceptedList = document.getElementById('accepted-appointments-list'); 
    const pastList = document.getElementById('past-appointments-list'); 
    if (!pendingList || !acceptedList || !pastList) {
         console.error("One or more appointment list elements not found in All Appointments view.");
         return; 
    } 
    pendingList.innerHTML = ''; acceptedList.innerHTML = ''; pastList.innerHTML = '';
    
    const mySpecialty = doctorProfile.specialty; 
    // Ensure specialty is loaded before filtering pending apps
    const pendingApps = mySpecialty 
        ? allAppointments.filter(app => app.status === 'Pending' && app.specialty === mySpecialty) 
        : []; // Show none if specialty unknown
        
    const acceptedApps = allAppointments.filter(app => app.status === 'Accepted' && app.doctorName === currentUsername); 
    const pastApps = allAppointments.filter(app => (app.status === 'Completed' || app.status === 'Rejected') && app.doctorName === currentUsername);
    
    const renderList = (list, apps, category) => { 
        if (apps.length === 0) { 
            list.innerHTML = `<p class="text-center text-gray-500 py-4">No appointments in this category.</p>`; 
            return; 
        } 
        // Sort accepted by date/time ascending, past by date/time descending
        if (category === 'accepted') { 
            apps.sort((a, b) => new Date(`${a.appointmentDate.split('T')[0]}T${a.appointmentTime}`) - new Date(`${b.appointmentDate.split('T')[0]}T${b.appointmentTime}`)); 
        } else if (category === 'past') { 
            apps.sort((a, b) => new Date(`${b.appointmentDate.split('T')[0]}T${b.appointmentTime}`) - new Date(`${a.appointmentDate.split('T')[0]}T${a.appointmentTime}`)); 
        } // No specific sort needed for pending
        
        apps.forEach(app => { 
            let actionsHtml = ''; 
            if (category === 'pending') { 
                actionsHtml = `<div class="actions flex gap-2"> <button class="action-btn accept-btn !p-0 w-9 h-9 flex items-center justify-center !rounded-full" data-id="${app.id}" title="Accept"><i class="fas fa-check"></i></button> <button class="action-btn primary reschedule-btn !p-0 w-9 h-9 flex items-center justify-center !rounded-full" data-id="${app.id}" title="Reschedule"><i class="fas fa-calendar-alt"></i></button> <button class="action-btn reject-btn !p-0 w-9 h-9 flex items-center justify-center !rounded-full" data-id="${app.id}" title="Reject"><i class="fas fa-times"></i></button> </div>`; 
            } else if (category === 'accepted') { 
                actionsHtml = `<div class="actions"> <button class="action-btn primary view-details-btn !p-0 w-10 h-10 flex items-center justify-center !rounded-full" data-id="${app.id}" title="Start Call"><i class="fas fa-video"></i></button> </div>`; 
            } else if (category === 'past') { 
                const buttonText = app.status === 'Rejected' ? 'View Reason' : 'View Notes'; 
                const iconClass = app.status === 'Rejected' ? 'fa-info-circle' : 'fa-sticky-note'; 
                actionsHtml = `<div class="actions"> <button class="action-btn secondary view-details-btn !p-0 w-10 h-10 flex items-center justify-center !rounded-full" data-id="${app.id}" title="${buttonText}"><i class="fas ${iconClass}"></i></button> </div>`; 
            }
            list.innerHTML += `
                <li class="card !p-3 flex items-center gap-4"> 
                    <div class="details flex-grow"> 
                        <h4 class="font-semibold">${app.patientFullName || app.patientName} - ${app.subject}</h4> 
                        <p class="text-sm text-[var(--text-secondary)]">${new Date(app.appointmentDate.split('T')[0] + 'T00:00:00').toLocaleDateString()} at ${app.appointmentTime}</p> 
                        <p class="text-sm">Status: <span class="font-semibold" style="color: ${getCalendarEventColor(app.status)}">${app.status}</span></p> 
                    </div> 
                    ${actionsHtml} 
                </li>`; 
        }); 
    };
    
    renderList(pendingList, pendingApps, 'pending'); 
    // Add message if specialty isn't loaded for pending
    if (!mySpecialty && pendingList.innerHTML === '') {
         pendingList.innerHTML = `<p class="text-center text-gray-500 py-4">Loading doctor specialty...</p>`;
    }
    renderList(acceptedList, acceptedApps, 'accepted'); 
    renderList(pastList, pastApps, 'past');
}
// --- END ALL APPOINTMENTS VIEW ---


// --- PROFILE VIEW ---
function renderProfile() {
    // Ensure doctorProfile is populated before rendering
    if (!doctorProfile || Object.keys(doctorProfile).length === 0) {
        console.warn("renderProfile called before doctorProfile was loaded.");
        // Optionally show loading indicators
        document.getElementById('profile-name').textContent = 'Loading...';
        document.getElementById('profile-age').textContent = 'Loading...';
        document.getElementById('profile-place').textContent = 'Loading...';
        document.getElementById('profile-phone').textContent = 'Loading...';
        document.getElementById('edit-profile-username').value = 'Loading...';
        document.getElementById('edit-profile-email').value = 'Loading...';
        document.getElementById('edit-profile-phone').value = 'Loading...';
        return;
    }

    updateProfilePicDisplay(doctorProfile); // Update picture first
    
    document.getElementById('profile-name').textContent = staticFullName || doctorProfile.fullName || 'N/A'; // Use staticFullName as primary
    document.getElementById('profile-age').textContent = doctorProfile.dob ? `${calculateAge(doctorProfile.dob)} years old` : 'N/A';
    document.getElementById('profile-place').textContent = doctorProfile.address || 'N/A';
    document.getElementById('profile-phone').textContent = doctorProfile.phone || 'N/A';
    
    // Populate edit form
    const usernameInput = document.getElementById('edit-profile-username');
    usernameInput.value = doctorProfile.username || '';
    usernameInput.disabled = false; // Ensure it's enabled after loading
    
    document.getElementById('edit-profile-email').value = doctorProfile.email || '';
    document.getElementById('edit-profile-phone').value = doctorProfile.phone || '';
}
function updateProfilePicDisplay(profile) {
    const createPicElement = (src, displayName) => { 
        const picUrl = src || `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName ? displayName.charAt(0) : 'D')}&background=4C7AFB&color=fff&bold=true&size=128`; 
        const picElement = document.createElement('img'); 
        picElement.src = picUrl; 
        picElement.alt = `${displayName || 'Profile'}'s profile picture`; 
        // Fallback if the src fails to load
        picElement.onerror = (e) => { 
            e.target.onerror = null; // Prevent infinite loop if fallback also fails
            e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName ? displayName.charAt(0) : 'D')}&background=4C7AFB&color=fff&bold=true&size=128`; 
        }; 
        return picElement; 
    };
    
    const displayName = staticFullName || profile?.fullName || profile?.username || ''; // Use staticFullName first
    
    const profilePicContainer = document.getElementById('profile-pic-container');
    if (profilePicContainer) { 
        const img = createPicElement(profile?.profilePicture, displayName); 
        img.className = 'w-36 h-36 object-cover rounded-2xl shadow-md border-4 border-[var(--bg-element)]'; 
        profilePicContainer.innerHTML = ''; // Clear previous content
        profilePicContainer.appendChild(img); 
    }
    
    const headerPicContainer = document.getElementById('doctor-profile-pic-container');
    if (headerPicContainer) { 
        const img = createPicElement(profile?.profilePicture, displayName); 
        img.className = 'w-9 h-9 object-cover rounded-full'; 
        headerPicContainer.innerHTML = ''; // Clear previous content
        headerPicContainer.appendChild(img); 
    }
}
function updateWelcomeMessage(profile) { 
    const welcomeNameSpan = document.querySelector('.welcome-name'); 
    // Prioritize staticFullName for display consistency
    const nameToDisplay = staticFullName || profile?.fullName || profile?.username || 'Doctor'; 
    if (welcomeNameSpan) { 
        welcomeNameSpan.textContent = nameToDisplay; 
    } 
    // Update header username display as well
     const headerUsernameDisplay = document.getElementById('doctor-username-display');
     if (headerUsernameDisplay) {
         headerUsernameDisplay.textContent = nameToDisplay;
     }
}
// --- END PROFILE VIEW ---


// --- MESSAGES VIEW ---
function renderMessagesView() {
    socket.emit('doctor:get:patients:chatted:with', { doctorUsername: currentUsername });
    document.getElementById('no-conversation-view').style.display = 'flex'; // Show placeholder
    document.getElementById('active-chat-view').style.display = 'none'; // Hide chat
    selectedPatient = null;
    selectedAppointmentIdForChat = null; // Reset appointment ID when view loads
}
function renderPatientList(patients) {
    const patientListEl = document.getElementById('patients-list-for-messaging');
    if (!patientListEl) return;
    
    // ⭐ FIX START: De-duplicate patients using Map
    const uniquePatientsMap = new Map();
    patients.forEach(patient => {
        // Uses the patientUsername as the definitive unique key
        uniquePatientsMap.set(patient.patientUsername, patient); 
    });
    const uniquePatients = Array.from(uniquePatientsMap.values());
    // ⭐ FIX END: uniquePatients list is now clean

    patientListEl.innerHTML = ''; // Clear previous list

    if (uniquePatients.length === 0) { 
        patientListEl.innerHTML = `<li class="text-center text-[var(--text-secondary)] p-4">No patient conversations found.</li>`; 
        return; 
    }

    const defaultPatientAvatar = '/images/default-avatar.png'; 
    const storedSelectedDoctor = sessionStorage.getItem('selectedDoctorUsername'); 

    uniquePatients.forEach(patient => {
        const profilePicSrc = patient.patientProfilePicture || defaultPatientAvatar;
        const li = document.createElement('li');
        
        // This is the active/hover styling class
        li.className = 'conversation-item flex items-center p-4 cursor-pointer transition-colors duration-200 border-l-4 border-transparent hover:bg-[rgba(var(--primary-rgb),0.05)]';
        li.dataset.patientUsername = patient.patientUsername;

        li.innerHTML = `
             <img src="${profilePicSrc}" alt="${patient.patientName}'s profile picture" class="w-12 h-12 rounded-full mr-4 object-cover" onerror="this.onerror=null; this.src='${defaultPatientAvatar}';">  
             <div class="flex-grow overflow-hidden">  
                 <div class="font-semibold truncate text-[var(--text-primary)]">${patient.patientName}</div>  
                 <div class="text-sm text-[var(--text-secondary)] truncate">Username: ${patient.patientUsername}</div>  
             </div>`;
        
        // This attaches the necessary click handler that you defined elsewhere in the file (e.g., inside window.onload)
        li.addEventListener('click', function(event) {
            // Re-using the click handler delegation logic you set up in DOMContentLoaded
            const conversationItem = event.currentTarget; 
            if (conversationItem) {
                 const doctorUsername = conversationItem.dataset.patientUsername; // Note: dataset is patientUsername here
                 if (doctorUsername) {
                      document.querySelectorAll('.conversation-item').forEach(item => item.classList.remove('active', 'bg-[rgba(var(--primary-rgb),0.1)]', 'border-l-[var(--primary-color)]'));
                      conversationItem.classList.add('active', 'bg-[rgba(var(--primary-rgb),0.1)]', 'border-l-[var(--primary-color)]');
                      selectedPatient = patient; 
                      sessionStorage.setItem('selectedDoctorUsername', doctorUsername); 
                      // Assuming fetchAndRenderChatHistory exists and takes patientUsername:
                      fetchAndRenderChatHistory(doctorUsername);
                 }
            }
        });

        patientListEl.appendChild(li);
    });
}
function appendMessageToChat(msg) {
    const chatMessagesContainer = document.getElementById('chat-messages-container'); if (!chatMessagesContainer) return;
    const placeholder = chatMessagesContainer.querySelector('.placeholder-text'); if (placeholder) placeholder.remove(); // Remove "No history" message
    
    const senderIsDoctor = msg.senderUsername === currentUsername;
    const bubbleClasses = senderIsDoctor ? 'sent ml-auto' : 'received mr-auto'; // Add margin auto for alignment
    let contentHtml = '';

    // Handle file URLs vs regular messages
    if (msg.fileUrl) {
        const isImage = /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(msg.fileUrl);
        if (isImage) {
            contentHtml = `<a href="${msg.fileUrl}" target="_blank" class="block max-w-[200px] md:max-w-[300px]"><img src="${msg.fileUrl}" alt="Shared image" class="rounded-lg object-contain max-h-60"></a>`;
        } else {
            // Try to extract a filename, default if fails
            const fileName = msg.fileUrl.split('/').pop() || 'Download File';
            contentHtml = `<a href="${msg.fileUrl}" target="_blank" download class="chat-file-link flex items-center gap-2 underline hover:no-underline"> <i class="fas fa-file-alt"></i> ${msg.message || fileName} </a>`; // Use message as text if available
        }
    } else {
        contentHtml = msg.message; // Just the text message
    }

    // Format timestamp
    const timestamp = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const messageHtml = `
        <div class="message-bubble w-fit max-w-[80%] ${bubbleClasses} rounded-2xl px-4 py-2 mb-2"> 
            <div class="message-text break-words">${contentHtml}</div> 
            <div class="message-timestamp text-xs mt-1 text-right opacity-80">${timestamp}</div> 
        </div>`;
    
    chatMessagesContainer.insertAdjacentHTML('beforeend', messageHtml);
    // Scroll to the bottom
    chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
}
function renderChatHistory(patientUsername, messages) {
    const chatMessagesContainer = document.getElementById('chat-messages-container'); 
    if (!chatMessagesContainer) {
        console.error("Chat messages container not found!");
        return;
    }
    chatMessagesContainer.innerHTML = ''; // Clear previous messages
    
    console.log(`[Render Chat History] Rendering ${messages?.length || 0} messages for ${patientUsername}`);

    if (!messages || messages.length === 0) { 
        chatMessagesContainer.innerHTML = `<p class="placeholder-text text-center text-gray-500 m-auto">No chat history found. Say hello!</p>`; 
        return; 
    }
    
    messages.forEach(appendMessageToChat); // Append each message
    // Scroll to bottom after rendering all history
    chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
}
// --- END MESSAGES VIEW ---


// --- Initialize Page ---
window.addEventListener('DOMContentLoaded', () => {
    console.log("DOM Content Loaded. Initializing Doctor Dashboard...");
    const user = getLoggedInUser();
    if (!user.username || user.role !== 'Doctor') { 
        alert('Access denied. Please log in as a Doctor.'); 
        window.location.href = '/'; // Redirect to login
        return; 
    }
    currentUsername = user.username; 
    currentRole = user.role; 
    staticFullName = user.fullName; // Store full name separately
    console.log(`User identified: ${currentUsername} (Role: ${currentRole}, FullName: ${staticFullName})`);

    // Initial UI setup
    updateWelcomeMessage({ username: currentUsername, fullName: staticFullName }); // Update welcome message immediately
    setupCalendarEventListeners(); 
    setupModalCloseButtons(); 
    showView('dashboard'); // Show dashboard by default

    // Sidebar Toggle Logic
    const sidebarToggleBtn = document.getElementById('sidebar-toggle-btn'); 
    const sidebar = document.querySelector('.sidebar'); 
    const sidebarOverlay = document.getElementById('sidebar-overlay'); 
    const toggleSidebar = () => { 
        if (!sidebar || !sidebarOverlay) return;
        sidebar.classList.toggle('-translate-x-full'); 
        sidebar.classList.toggle('translate-x-0'); 
        sidebarOverlay.classList.toggle('hidden'); 
        document.body.classList.toggle('overflow-hidden'); // Prevent scrolling when sidebar is open on mobile
    }; 
    if (sidebarToggleBtn && sidebar && sidebarOverlay) { 
        sidebarToggleBtn.addEventListener('click', toggleSidebar); 
        sidebarOverlay.addEventListener('click', toggleSidebar); 
    }

    // Sidebar Navigation Logic
    document.querySelectorAll('.sidebar-nav a').forEach(link => link.addEventListener('click', (e) => { 
        if (e.currentTarget.id !== 'logoutBtn') {
             e.preventDefault(); // Prevent default link behavior unless it's logout
             const view = e.currentTarget.dataset.view; 
             if(view) showView(view); 
             // Close sidebar on mobile after clicking a link
             if (window.innerWidth <= 768 && sidebar && sidebar.classList.contains('translate-x-0')) {
                  toggleSidebar(); 
             }
        } 
        // Logout logic is handled separately below
    }));

    // Profile Pic Upload Logic
    const profilePicContainer = document.getElementById('profile-pic-container'); 
    const profilePicUploadInput = document.getElementById('profile-pic-upload'); 
    if (profilePicContainer && profilePicUploadInput) { 
        profilePicContainer.addEventListener('click', () => profilePicUploadInput.click()); 
        profilePicUploadInput.addEventListener('change', (event) => { 
            const file = event.target.files[0]; 
            if (file) { 
                if (!file.type.startsWith('image/')) { alert('Please select an image file.'); return; } 
                if (file.size > 2 * 1024 * 1024) { alert('Image size must be less than 2MB.'); return; } 
                const reader = new FileReader(); 
                reader.onload = function(e) { 
                    console.log("Profile picture selected, emitting update...");
                    socket.emit('doctor:update:profile-picture', { username: currentUsername, imageData: e.target.result }); 
                }; 
                reader.readAsDataURL(file); 
            } 
            event.target.value = null; // Reset input value to allow re-uploading the same file
        }); 
    }

    // Save Profile Button Logic
    const saveProfileBtn = document.getElementById('save-profile-btn'); 
    if (saveProfileBtn) { 
        saveProfileBtn.addEventListener('click', () => { 
            const oldUsername = doctorProfile.username; // Get username from loaded profile
            const newUsernameInput = document.getElementById('edit-profile-username');
            const newUsername = newUsernameInput.value.trim(); 
            const email = document.getElementById('edit-profile-email').value.trim(); 
            const phone = document.getElementById('edit-profile-phone').value.trim(); 

            if (!newUsername) {
                 alert("Username cannot be empty.");
                 newUsernameInput.focus();
                 return;
            }
            
            // Construct data with potentially updated username
            const updatedProfileData = { 
                username: newUsername, // Use the potentially edited username
                fullName: staticFullName, // Keep original full name for now (or add field to edit it)
                specialty: doctorProfile.specialty, // Keep existing specialty
                email: email, 
                phone: phone, 
                profilePicture: doctorProfile.profilePicture // Keep existing picture URL
            }; 
            
            console.log("Saving profile changes:", updatedProfileData, "Old username:", oldUsername);
            socket.emit('user:update-profile', { profile: updatedProfileData, oldUsername: oldUsername }, (response) => { 
                if (response.success) { 
                    alert('Profile updated successfully!'); 
                    if (newUsername !== oldUsername) { 
                        // Update local storage and currentUsername if username changed
                        localStorage.setItem('telemedicine_user', newUsername); 
                        currentUsername = newUsername; 
                        console.log("Username changed locally to:", currentUsername);
                    }
                    // Fetch updated profile from server to ensure sync
                    socket.emit('user:get-profile', { username: currentUsername }); 
                } else { 
                    alert('Error updating profile: ' + (response.message || 'Unknown error.')); 
                    // Re-render profile with original data on error
                    renderProfile(); 
                } 
            }); 
        }); 
    }

    // Change Password Button & Form Logic
    const changePasswordBtn = document.getElementById('change-password-btn'); 
    if (changePasswordBtn) changePasswordBtn.addEventListener('click', () => showModal('change-password-modal')); 
    
    const changePasswordForm = document.getElementById('change-password-form'); 
    if (changePasswordForm) { 
        changePasswordForm.addEventListener('submit', (e) => { 
            e.preventDefault(); 
            const currentPass = document.getElementById('current-password').value; 
            const newPass = document.getElementById('new-password').value; 
            const confirmPass = document.getElementById('confirm-password').value; 
            const passwordError = document.getElementById('password-error'); 
            
            passwordError.classList.add('hidden'); // Reset error message

            if (newPass !== confirmPass) { 
                passwordError.textContent = 'New passwords do not match.'; 
                passwordError.classList.remove('hidden'); 
                return; 
            } 
            if (newPass.length < 8) { 
                passwordError.textContent = 'New password must be at least 8 characters.'; 
                passwordError.classList.remove('hidden'); 
                return; 
            } 
            
            console.log("Submitting password change request...");
            socket.emit('doctor:change:password', { username: currentUsername, currentPassword: currentPass, newPassword: newPass }, (response) => { 
                if (response.success) { 
                    alert('Password changed successfully!'); 
                    hideModal('change-password-modal'); 
                    e.target.reset(); // Clear the form
                } else { 
                    passwordError.textContent = response.message || 'An error occurred while changing password.'; 
                    passwordError.classList.remove('hidden'); 
                } 
            }); 
        }); 
    }

    // Help Button Logic
    const helpFabBtn = document.getElementById('help-fab-btn'); 
    if (helpFabBtn) helpFabBtn.addEventListener('click', () => showModal('help-modal'));

    // Logout Button Logic
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', (e) => { 
            e.preventDefault(); // Prevent default link behavior
            console.log("Logging out...");
            localStorage.removeItem('telemedicine_user'); 
            localStorage.removeItem('telemedicine_role'); 
            localStorage.removeItem('telemedicine_fullname'); 
            window.location.href = '/'; // Redirect to login page
        });
    }

    // Send Message Button & Input Logic
    const sendMessageBtn = document.getElementById('doctor-send-message-btn'); 
    const messageInput = document.getElementById('doctor-message-input'); 
    const sendMessage = () => { 
        const message = messageInput.value.trim(); 
        if (message && selectedPatient && selectedAppointmentIdForChat) { 
            const messageData = { 
                senderUsername: currentUsername, 
                receiverUsername: selectedPatient.patientUsername, 
                message: message, 
                senderFullName: staticFullName, // Send doctor's name
                appointmentId: selectedAppointmentIdForChat // Link message to appointment
            }; 
            console.log("Sending message:", messageData);
            socket.emit('dashboard:send:message', messageData); 
            
            // Optimistic UI update (add message immediately)
            const optimisticMessage = { 
                senderUsername: currentUsername, 
                message: message, 
                timestamp: new Date().toISOString(), 
                // No receiver info needed for display logic
            }; 
            appendMessageToChat(optimisticMessage); 
            
            messageInput.value = ''; // Clear input
            messageInput.focus(); // Keep focus on input
        } else if (!selectedPatient) { 
            alert("Please select a patient to send a message to."); 
        } else if (!selectedAppointmentIdForChat) { 
            alert("Cannot send message. No active or completed appointment found for this patient to associate the message with."); 
        } else if (!message) {
            // Optionally provide feedback if message is empty, though trim() handles whitespace
        }
    }; 
    if (sendMessageBtn) sendMessageBtn.addEventListener('click', sendMessage); 
    if (messageInput) messageInput.addEventListener('keypress', (e) => { 
        // Send on Enter key, but not Shift+Enter
        if (e.key === 'Enter' && !e.shiftKey) { 
            e.preventDefault(); // Prevent new line
            sendMessage(); 
        } 
    });
});
// --- END Initialize Page ---


// --- Socket Event Handlers ---
socket.on('connect', () => {
    console.log('[Socket] Connected to server via Socket.IO');
    const user = getLoggedInUser();
    if (user.username) {
        // Identify user to the server upon connection
        socket.emit('user:online', { username: user.username, role: user.role }, (response) => {
             console.log('[Socket] user:online acknowledged by server:', response);
            if (response && response.success) {
                 console.log('[Socket] User identified. Proceeding with initial data fetch.');
                // Fetch initial data needed for the dashboard
                socket.emit('get:all:appointments'); 
                socket.emit('user:get-profile', { username: currentUsername }); // Fetch full profile
            } else {
                console.error('[Socket] Failed to identify user with server after connection.', response?.message);
                alert('Error connecting to user session. Please refresh.');
            }
        });
    } else {
        console.error("[Socket Connect] No username found in local storage. Cannot identify user.");
        // Consider redirecting to login here
    }
});

socket.on('disconnect', (reason) => {
     console.warn('[Socket] Disconnected from server:', reason);
     // Optionally, show a disconnected message to the user
});

socket.on('connect_error', (error) => {
    console.error('[Socket] Connection Error:', error);
    // Optionally, show an error message
});


socket.on('appointments:refetch', () => {
    console.log('[Real-time] Received appointments:refetch signal. Fetching updated appointments...');
    socket.emit('get:all:appointments');
});

socket.on('appointments:update', (data) => {
    console.log('[Socket] Received appointments:update');
    if (data && Array.isArray(data.appointments)) { // Ensure it's an array
        allAppointments = data.appointments;
        console.log(`Updated appointments list. Count: ${allAppointments.length}`); 

        // Re-render the currently active view to reflect changes
        const activeView = document.querySelector('.view-content:not(.hidden)');
        const activeViewId = activeView ? activeView.id : null;
        console.log(`Current view: ${activeViewId}. Re-rendering relevant components.`);
        
        if (activeViewId === 'dashboard-view') renderDashboard();
        else if (activeViewId === 'appointments-view') renderAllAppointments();
        else if (activeViewId === 'calendar-view') renderCalendar();
        
        // ⭐ FIX: Force refresh the messaging list EVERY time an appointment updates.
        // This ensures that as soon as you click "Accept", the patient appears in your chat list.
        console.log("[Appointments Update] Refreshing chat patient list...");
        socket.emit('doctor:get:patients:chatted:with', { doctorUsername: currentUsername });

        // If we are currently looking at the messages view, handle specific active chat updates
        if (activeViewId === 'messages-view') {
             // Re-check relevant appointment for current chat if a patient is selected
             if (selectedPatient) {
                  const relevantAppointment = allAppointments
                       .filter(app => (app.patientName === selectedPatient.patientUsername || app.patientFullName === selectedPatient.patientName) && (app.status === 'Accepted' || app.status === 'Completed') && app.doctorName === currentUsername)
                       .sort((a, b) => new Date(`${b.appointmentDate.split('T')[0]}T${b.appointmentTime}`) - new Date(`${a.appointmentDate.split('T')[0]}T${a.appointmentTime}`))[0];
                    
                  const oldAppointmentId = selectedAppointmentIdForChat;
                  selectedAppointmentIdForChat = relevantAppointment ? relevantAppointment.id : null;
                    
                  if (oldAppointmentId !== selectedAppointmentIdForChat) {
                         console.warn(`[Appointments Update] Relevant appointment ID for current chat changed from ${oldAppointmentId} to ${selectedAppointmentIdForChat}`);
                  }
             }
        }
        // No specific update needed for profile view on appointment changes
        
    } else {
        console.warn('[Socket] Received appointments:update without valid appointments array.');
    }
});

// Notifications and specific appointment updates
socket.on('appointment:rescheduled', (response) => { 
    if (response.success) { 
        alert('Your reschedule proposal has been sent to the patient.'); 
        socket.emit('get:all:appointments'); // Refresh list
    } else { 
        alert('Error rescheduling appointment: ' + (response.message || 'Unknown error.')); 
    } 
});
socket.on('notification:reschedule-accepted', (data) => { alert(data.message); playNotificationSound(); socket.emit('get:all:appointments'); });
socket.on('notification:reschedule-rejected', (data) => { alert(data.message); playNotificationSound(); socket.emit('get:all:appointments'); });
socket.on('notification:new-time-proposed', (data) => { alert(data.message); playNotificationSound(); socket.emit('get:all:appointments'); });
socket.on('notification:new-request', (data) => { 
    console.log("Received notification:new-request", data);
    playNotificationSound(); 
    socket.emit('get:all:appointments'); 
});


// Profile Updates
socket.on('user:profile-update', (data) => { 
    console.log("[Socket] Received user:profile-update", data);
    if (data && data.profile) { 
        // Update local profile object
        doctorProfile = data.profile; 
        
        // Update staticFullName if needed (this might come from login or profile update)
        if (data.profile.fullName && (!staticFullName || staticFullName !== data.profile.fullName)) { 
            staticFullName = data.profile.fullName; 
            localStorage.setItem('telemedicine_fullname', staticFullName); 
            console.log("Updated staticFullName to:", staticFullName);
        }
        
        // Update UI elements
        updateWelcomeMessage(doctorProfile); // Updates header and welcome message
        updateProfilePicDisplay(doctorProfile); // Updates profile and header pics
        
        // If profile view is active, re-render it
        if (document.getElementById('profile-view')?.classList.contains('hidden') === false) {
              renderProfile(); 
        }

        // Check if username changed and update local storage if necessary
        const localUsername = localStorage.getItem('telemedicine_user');
        if (localUsername !== doctorProfile.username) { 
            localStorage.setItem('telemedicine_user', doctorProfile.username); 
            currentUsername = doctorProfile.username; 
            console.log("Username updated locally via profile update:", currentUsername); 
        } 
    } else {
         console.warn("[Socket] Received user:profile-update without valid profile data.");
    }
});
// Confirmation messages from server after profile/pic updates initiated by this client
socket.on('doctor:profile:updated', (response) => { 
    if (response.success) { 
        alert('Profile updated successfully!'); 
        // Profile data should already be updated via 'user:profile-update', no need to fetch again unless needed
        // socket.emit('user:get-profile', { username: currentUsername }); 
    } else { 
        alert('Error updating profile: ' + (response.message || 'Unknown error.')); 
        // Optionally revert UI changes or fetch profile again to be sure
        socket.emit('user:get-profile', { username: currentUsername }); 
    } 
});
socket.on('doctor:profile-picture:updated', (response) => { 
    if (response.success) { 
        alert('Profile picture updated!'); 
        // The 'user:profile-update' event should handle the UI update
        // No need to fetch profile again just for picture update if 'user:profile-update' is reliable
    } else { 
        alert('Error updating profile picture: ' + (response.message || 'Unknown error.')); 
        // Fetch profile again to revert to the old picture URL if the update failed server-side
        socket.emit('user:get-profile', { username: currentUsername }); 
    } 
});

// Messaging Updates
socket.on('doctor:patients:chatted:with', ({ patients }) => { 
    console.log("[Socket] Received doctor:patients:chatted:with", patients);
    currentPatients = patients || []; // Ensure it's an array
    renderPatientList(currentPatients); 
});
socket.on('doctor:chat:history', ({ patientUsername, chatHistory }) => { 
    console.log(`[Socket] Received doctor:chat:history for ${patientUsername}`);
    // Only render if the history is for the currently selected patient
    if (selectedPatient && selectedPatient.patientUsername === patientUsername) {
        renderChatHistory(patientUsername, chatHistory); 
    } else {
         console.log(`[Socket] Received chat history for ${patientUsername}, but current chat is for ${selectedPatient?.patientUsername || 'nobody'}. Ignoring.`);
    }
});
socket.on('dashboard:message:received', (message) => {
    console.log("[Socket] Received dashboard:message:received", message);
    const isFromCurrentPatient = selectedPatient && message.senderUsername === selectedPatient.patientUsername;
    const isOptimisticEcho = message.senderUsername === currentUsername && selectedPatient && message.receiverUsername === selectedPatient.patientUsername;

    if (isFromCurrentPatient) {
        // If the message is from the patient we are currently chatting with, append it
        appendMessageToChat(message);
        playNotificationSound(); // Play sound even if chat is open
    } else if (!isOptimisticEcho && message.senderUsername !== currentUsername) { 
        // If it's a new message from a *different* patient (and not our own echo)
        const patient = currentPatients.find(p => p.patientUsername === message.senderUsername); 
        const senderDisplay = patient ? patient.patientName : message.senderUsername; 
        console.log(`New message received from ${senderDisplay} (not current chat).`); 
        playNotificationSound(); 
        // Optionally: Add a visual indicator to the patient list
        // Optionally: Show a toast notification
    }
    // Ignore optimistic echos (messages sent by the current doctor to the current patient)
    // as they were already added to the UI optimistically.
});

// User Status Updates
socket.on('user:status-changed', ({ username, isOnline }) => { 
    console.log(`[Socket] User status changed: '${username}' is now ${isOnline ? 'online' : 'offline'}.`); 
    const statusEl = document.getElementById('chat-header-status'); 
    // Update status in chat header if it's the currently selected patient
    if (selectedPatient && selectedPatient.patientUsername === username && statusEl) { 
        statusEl.textContent = isOnline ? 'Online' : 'Offline'; 
    }
    // Optionally: Update status indicator in the patient list as well
});
// --- END Socket Event Handlers ---


// --- Main Click Event Delegation ---
document.addEventListener('click', (e) => {
    const target = e.target.closest('button'); if (!target) return; // Only interested in button clicks

    const appointmentId = target.dataset.id; // Used by accept, reject, view details (outside calendar)
    const isAcceptBtn = target.classList.contains('accept-btn');
    const isRejectBtn = target.classList.contains('reject-btn');
    const isViewDetailsBtn = target.classList.contains('view-details-btn');
    const isRescheduleBtn = target.classList.contains('reschedule-btn'); // Generic reschedule class

    // --- Reschedule Button (Outside Calendar Modal) ---
    // The reschedule button *inside* the calendar modal is handled by `setupCalendarEventListeners`
    if (isRescheduleBtn && !target.closest('#modal-appointments-list') && appointmentId) {
        const appointment = allAppointments.find(app => app.id == appointmentId);
        if (appointment) {
            console.log("[Main Click Handler] Reschedule button (outside calendar modal) clicked for ID:", appointmentId);
            showRescheduleModal(appointment);
        } else {
            console.error("[Main Click Handler] Reschedule - Could not find appointment with ID:", appointmentId);
            alert("Error: Could not find appointment details to reschedule.");
        }
    }
    // --- Accept Button ---
    else if (isAcceptBtn && appointmentId) {
        const appointmentToAccept = allAppointments.find(app => app.id == appointmentId);
        if (!appointmentToAccept) { alert('Error: Could not find appointment details.'); return; }
        if (hasConflict(appointmentToAccept.appointmentDate, appointmentToAccept.appointmentTime)) { alert('Schedule Conflict: You already have an accepted appointment at this time.'); return; }
        console.log("[Main Click Handler] Accept button clicked for ID:", appointmentId);
        socket.emit('appointment:accept', { appointmentId: appointmentId, doctorName: currentUsername }, (response) => {
            if (response.success) { alert('Appointment accepted successfully!'); }
            else { alert('Error accepting appointment: ' + (response.message || 'Unknown error.')); }
        });
    }
    // --- Reject Button ---
    else if (isRejectBtn && appointmentId) {
        rejectionAppointmentId = appointmentId;
        console.log("[Main Click Handler] Reject button clicked, opening reject modal for ID:", appointmentId);
        showModal('reject-modal');
    }
    // --- View Details / Start Call Button ---
    else if (isViewDetailsBtn && appointmentId) {
        const appointment = allAppointments.find(app => app.id == appointmentId);
        if (appointment) {
            console.log("[Main Click Handler] View Details clicked for appointment:", appointment);
            if (appointment.status === 'Accepted' || appointment.status === 'Rescheduled-Pending') {
                console.log("--> Status Accepted/Rescheduled, showing Call Details Modal.");
                showCallDetailsModal(appointment);
            } else if (appointment.status === 'Completed' || appointment.status === 'Rejected') {
                console.log("--> Status Completed/Rejected, showing Notes Modal (read-only).");
                document.getElementById('notesPatientName').textContent = appointment.patientFullName || appointment.patientName;
                document.getElementById('notesSubject').textContent = appointment.subject;
                document.getElementById('notesDate').textContent = new Date(appointment.appointmentDate.split('T')[0] + 'T00:00:00').toLocaleDateString();
                document.getElementById('notesTime').textContent = appointment.appointmentTime;
                const notes = appointment.notes || appointment.rejectionNotes || (appointment.status === 'Rejected' ? 'No rejection reason provided.' : 'No notes saved.');
                document.getElementById('doctorNotes').value = notes;
                document.getElementById('notesModal').dataset.appointmentId = appointmentId; // Store ID for reference if needed
                setupDiagnosisSelectors(false); // Setup selectors (read-only state)
                populateSelectorsFromNotes(notes); // Try to fill them
                document.getElementById('diagnosis-type-select').disabled = true; // Ensure disabled
                document.getElementById('diagnosis-specific-select').disabled = true; // Ensure disabled
                document.getElementById('doctorNotes').readOnly = true; // Ensure read-only
                document.getElementById('saveNotesBtn').classList.add('hidden'); // Hide save button
                showModal('notesModal');
            } else {
                 console.warn("[Main Click Handler] View Details - Appointment status is unexpected:", appointment.status);
                 alert("Cannot view details for an appointment with status: " + appointment.status);
            }
        } else {
            console.error("[Main Click Handler] View Details - Could not find appointment with ID:", appointmentId);
            alert("Error: Could not find appointment details.");
        }
    }
    // --- Create / Join Call Button (Inside Call Details Modal) ---
    else if (target.id === 'createJoinCallBtn') {
        const currentAppointmentId = target.dataset.appointmentId;
        console.log(`[Create/Join Call] Clicked for appointment ID: ${currentAppointmentId}`);
        
        // Only trigger "Create" logic if the button text actually says "Create"
        // (If it says "Join", the click is handled by the listener inside showCallDetailsModal)
        if (target.textContent.includes('Create')) {
            target.disabled = true;
            target.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Creating...';

            socket.emit('doctor:create-room', { appointmentId: currentAppointmentId, doctorName: currentUsername }, (response) => {
                console.log('[Create Call] Response:', response);

                if (response && response.success) {
                    // Find the appointment in local state
                    const appointment = allAppointments.find(app => app.id == currentAppointmentId);
                    
                    if (appointment) {
                        // 1. Optimistically update room status
                        appointment.roomCreated = 1; 
                        
                        // 2. Re-open the modal with the NEW redirect URL from server
                        // ⭐ IMPORTANT: We pass the URL here, we do NOT overwrite appointment.authToken
                        showCallDetailsModal(appointment, response.redirectUrl);
                    }
                } else {
                    alert(response.message || 'Failed to create call.');
                    target.disabled = false;
                    target.textContent = 'Create Call';
                }
            });
        }
    }
    // --- Finish Appointment Button (Inside Call Details Modal) ---
    else if (target.id === 'finishAppointmentBtn') { 
        const currentAppointmentId = target.dataset.appointmentId;
        console.log("[Finish Appointment Button Click] Clicked for ID:", currentAppointmentId);
        hideModal('callDetailsModal'); 
        const appointment = allAppointments.find(app => app.id == currentAppointmentId); 
        if (appointment) { 
            console.log("[Finish Appointment] Found appointment, opening Notes Modal (editable).", appointment);
            document.getElementById('notesPatientName').textContent = appointment.patientFullName || appointment.patientName; 
            document.getElementById('notesSubject').textContent = appointment.subject; 
            document.getElementById('notesDate').textContent = new Date(appointment.appointmentDate.split('T')[0] + 'T00:00:00').toLocaleDateString(); 
            document.getElementById('notesTime').textContent = appointment.appointmentTime; 
            
            // Set up notes section
            document.getElementById('doctorNotes').value = appointment.notes || ''; 
            document.getElementById('doctorNotes').readOnly = false; 
            document.getElementById('notesModal').dataset.appointmentId = currentAppointmentId; 
            document.getElementById('saveNotesBtn').classList.remove('hidden'); 
            
            // Set up diagnosis selectors
            setupDiagnosisSelectors(true); 
            populateSelectorsFromNotes(appointment.notes); 
            document.getElementById('diagnosis-type-select').disabled = false; 
            document.getElementById('diagnosis-specific-select').disabled = !document.getElementById('diagnosis-type-select').value; 
            
            updateDiagnosisTextarea(); 
            
            showModal('notesModal'); 
        } else {
            console.error("[Finish Appointment] Could not find appointment with ID:", currentAppointmentId);
            alert("Error: Could not find appointment details to finish.");
        }
    }
});
// --- END Main Click Event Delegation ---


// --- Other Modal Button Handlers ---
// Confirm Reject Button (Inside Reject Modal)
const confirmRejectBtn = document.getElementById('confirm-reject-btn');
if (confirmRejectBtn) {
    confirmRejectBtn.addEventListener('click', () => { 
        const rejectionReason = document.getElementById('reject-notes-textarea').value; 
        console.log("[Confirm Reject Button Click] Reason:", rejectionReason, "for ID:", rejectionAppointmentId);
        if (rejectionReason.trim() === '') { alert('Please provide a reason for the rejection.'); return; } 
        if (rejectionAppointmentId) { 
            socket.emit('appointment:reject-with-notes', { appointmentId: rejectionAppointmentId, doctorName: currentUsername, notes: rejectionReason }, (response) => { 
                if (response.success) { 
                    console.log("[Confirm Reject] Rejection successful.");
                    hideModal('reject-modal'); 
                    document.getElementById('reject-notes-textarea').value = ''; 
                    rejectionAppointmentId = null; 
                    alert('Appointment rejected successfully!'); 
                    // No need to explicitly refetch, appointments:update should cover it
                } else { 
                    console.error("[Confirm Reject] Rejection failed:", response);
                    alert('Error: ' + (response.message || 'Failed to reject appointment.')); 
                } 
            }); 
        } else {
            console.error("[Confirm Reject] rejectionAppointmentId is null!");
        }
    });
} else { console.error("Confirm Reject Button not found"); }

// Cancel Reject Button (Inside Reject Modal)
const cancelRejectBtn = document.getElementById('cancel-reject-btn');
if (cancelRejectBtn) {
    cancelRejectBtn.addEventListener('click', () => { 
        console.log("[Cancel Reject Button Click] Hiding modal, clearing ID.");
        hideModal('reject-modal'); 
        document.getElementById('reject-notes-textarea').value = ''; 
        rejectionAppointmentId = null; 
    });
} else { console.error("Cancel Reject Button not found"); }

// Save Notes Button (Inside Notes Modal)
const saveNotesBtn = document.getElementById('saveNotesBtn');
if (saveNotesBtn) {
    saveNotesBtn.addEventListener('click', () => { 
        const appointmentId = document.getElementById('notesModal').dataset.appointmentId; 
        const notes = document.getElementById('doctorNotes').value; 
        const diagnosisTypeSelect = document.getElementById('diagnosis-type-select'); 
        const diagnosisSpecificSelect = document.getElementById('diagnosis-specific-select'); 
        
        console.log("[Save Notes Button Click] Attempting to save for ID:", appointmentId);
        console.log("[Save Notes] Diagnosis Type:", diagnosisTypeSelect.value);
        console.log("[Save Notes] Specific Diagnosis:", diagnosisSpecificSelect.value);
        // console.log("[Save Notes] Notes Content:", notes); // Can be long

        if (!diagnosisTypeSelect.value || !diagnosisSpecificSelect.value) { 
            alert('Please select both a Diagnosis Type and a Specific Diagnosis before saving.'); 
            return; 
        } 
        
        const specificDiagnosis = diagnosisSpecificSelect.value; 
        
        // Disable button while saving
        saveNotesBtn.disabled = true;
        saveNotesBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Saving...';

        socket.emit('appointment:save-notes', { appointmentId, notes, diagnosis: specificDiagnosis }, (response) => {
            // Re-enable button regardless of outcome
            saveNotesBtn.disabled = false;
            saveNotesBtn.textContent = 'Save & Finish';

            if (response && response.success) {
                console.log("[Save Notes] Server confirmed notes saved successfully.");
                alert('Appointment finished and notes saved!'); 
                hideModal('notesModal'); 
                // No need to emit get:all:appointments here, server should trigger appointments:update
            } else {
                 console.error("[Save Notes] Server reported an error saving notes:", response);
                 alert("Error saving notes: " + (response?.message || "Unknown server error."));
                 // Keep the modal open on error
            }
        }); 
    });
} else { console.error("Save Notes Button not found"); }
// --- END Other Modal Button Handlers ---

// --- Initial Setup Calls ---
// These are called once the DOM is ready (inside DOMContentLoaded)
// setupCalendarEventListeners(); // Already called in DOMContentLoaded
// setupModalCloseButtons(); // Already called in DOMContentLoaded
console.log("Initial setup calls completed in DOMContentLoaded.");
// --- END Initial Setup Calls ---