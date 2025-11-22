// script-base.js

'use strict'; // Added strict mode for better code quality and error prevention

// --- DOM Elements ---
const loadingScreenDiv = document.getElementById('loading-screen');
const callInterfaceDiv = document.getElementById('call-interface');
const activeRoomCodeSpan = document.getElementById('activeRoomCode');
const mainVideo = document.getElementById('mainVideo');
const mainVideoContainer = document.getElementById('mainVideoContainer');
const miniVideo = document.getElementById('miniVideo');
const mainVideoNameLabel = document.getElementById('mainVideoNameLabel');
const miniVideoNameLabel = document.getElementById('miniVideoNameLabel');
const miniVideoContainer = document.getElementById('miniVideoContainer');
const toggleMicBtn = document.getElementById('toggleMicBtn');
const toggleCamBtn = document.getElementById('toggleCamBtn');
const endCallBtn = document.getElementById('endCallBtn');
const callTimerSpan = document.getElementById('callTimer');
const chatBox = document.getElementById('chat-box');
const chatInput = document.getElementById('chatInput');
const sendChatBtn = document.getElementById('sendChatBtn');
const fileInput = document.getElementById('fileInput');
const fileIcon = document.getElementById('fileIcon');
const takePictureBtn = document.getElementById('takePictureBtn');
// const photoCanvas = document.getElementById('photoCanvas'); // This was unused, hiddenPhotoCanvas is used now.
const toggleChatBtn = document.getElementById('toggleChatBtn');
const chatContainer = document.getElementById('chat-container');
const exitChatBtn = document.getElementById('exitChatBtn');
const chatPeerNameDisplay = document.getElementById('chatPeerNameDisplay');
const peerStatusDot = document.getElementById('peerStatusDot');
const typingIndicator = document.getElementById('typingIndicator'); // DOM element for typing indicator
const saveChatHistoryBtn = document.getElementById('saveChatHistoryBtn'); // Added this

// New DOM elements for Camera POV Interface
const cameraPovInterface = document.getElementById('camera-pov-interface');
const cameraPovVideo = document.getElementById('cameraPovVideo');
const hiddenPhotoCanvas = document.getElementById('hiddenPhotoCanvas');
const captureShotBtn = document.getElementById('captureShotBtn');
const switchCamPovBtn = document.getElementById('switchCamPovBtn'); // NEW: Switch Camera Button
const recordingIndicator = document.getElementById('recordingIndicator'); // NEW: Recording indicator
const backToCallBtn = document.getElementById('backToCallBtn');

// New DOM elements for Shot Preview UI
const shotPreviewInterface = document.getElementById('shot-preview-interface');
const capturedShotImage = document.getElementById('capturedShotImage');
const capturedVideoPreview = document.getElementById('capturedVideoPreview'); // NEW: Video preview element
const retakeShotBtn = document.getElementById('retakeShotBtn');
const sendShotBtn = document.getElementById('sendShotBtn');
const controlTab = document.getElementById('control-tab'); // or the correct ID/class

// New DOM elements for the call ended modal
const callEndedModal = document.getElementById('call-ended-modal');
const callEndedMessage = document.getElementById('call-ended-message');
const callEndedOkBtn = document.getElementById('call-ended-ok-btn');

// --- Global Variables ---
let localStream;
let remoteStream = new MediaStream(); // Initialize remoteStream as an empty MediaStream
let peerConnections = new Map(); // Stores peerId -> RTCPeerConnection
let peerNameMap = new Map(); // This `peerNameMap` is likely superseded by `remoteUsernames` in script-logic.js
                                     // It's safe to keep as a stub if other parts of your code refer to it,
                                     // but `remoteUsernames` should be the primary mapping.
let currentRoomId = null;
let currentUsername = null;
let callStartTime;
let callTimerInterval;
let selectedFileForUpload = null; // To hold the file selected for staged sending
let typingTimeout; // To manage when typing stops for the typing indicator (sender side)
const TYPING_TIMEOUT_DELAY = 1500; // 1.5 seconds delay to consider typing stopped
let remoteTypingDisplayTimeout; // To manage when typing stops for the typing indicator (receiver side)
const REMOTE_TYPING_DISPLAY_DURATION = 3000; // Hide typing indicator after 3 seconds of no updates from remote peer

// --- Mini Video Container & Control Tab Logic (Consolidated) ---
let miniVideoHideTimer;
let controlTabHideTimer; // Timer for hiding the control tab

/**
 * Shows the mini video container and resets its hide timer.
 */
function showMiniVideo() {
    if (!miniVideoContainer) return;

    console.log('[MiniVideo_Trace] showMiniVideo called. Current classList:', miniVideoContainer.classList.value);
    clearTimeout(miniVideoHideTimer);

    miniVideoContainer.classList.remove('mini-preview-hidden');

    miniVideoHideTimer = setTimeout(hideMiniVideo, 3000);

    if (miniVideo) {
        console.log('[MiniVideo_Trace] showMiniVideo - miniVideo state: paused=', miniVideo.paused, ' readyState=', miniVideo.readyState, ' currentTime=', miniVideo.currentTime);
        if (miniVideo.srcObject && miniVideo.srcObject.getVideoTracks().length > 0) {
            const track = miniVideo.srcObject.getVideoTracks()[0];
            console.log('[MiniVideo_Trace] showMiniVideo - Track state: enabled=', track.enabled, ' readyState=', track.readyState);
        }
    }
}

/**
 * Hides the mini video container.
 */
function hideMiniVideo() {
    if (!miniVideoContainer) return;
    console.log('[MiniVideo_Trace] hideMiniVideo called. Current classList:', miniVideoContainer.classList.value);
    miniVideoContainer.classList.add('mini-preview-hidden');
    console.log('[MiniVideo_Trace] hideMiniVideo - miniVideo is now hidden.');
}

/**
 * Resets the timer for hiding the mini video.
 */
function resetMiniVideoHideTimer() {
    clearTimeout(miniVideoHideTimer);
    miniVideoHideTimer = setTimeout(hideMiniVideo, 3000);
}

/**
 * NEW: Shows the control tab and starts a timer to hide it after a period of inactivity.
 */
function resetControlTabTimer() {
    if (!controlTab) return;

    // Make the control tab visible by removing the hidden class
    controlTab.classList.remove('controls-hidden');

    // Clear any existing timer to prevent premature hiding
    clearTimeout(controlTabHideTimer);

    // Set a new timer to hide the controls after 2 seconds
    controlTabHideTimer = setTimeout(() => {
        if (controlTab) { // Check if element still exists
            controlTab.classList.add('controls-hidden');
        }
    }, 2000); // Hide after 2 seconds of inactivity
}


// --- General Display/UI Control Functions ---

/**
 * Displays the loading screen and hides other interfaces.
 */
function showLoadingScreen() {
    loadingScreenDiv.style.display = 'flex';
    callInterfaceDiv.style.display = 'none';
    cameraPovInterface.style.display = 'none';
    shotPreviewInterface.style.display = 'none';
}

/**
 * Displays the main call interface and hides other interfaces.
 */
function showCallInterface() {
    loadingScreenDiv.style.display = 'none';
    cameraPovInterface.style.display = 'none';
    shotPreviewInterface.style.display = 'none';
    callInterfaceDiv.style.display = 'flex';
}

/**
 * Displays the camera POV interface for taking pictures.
 */
function showCameraPovInterface() {
    console.log('[showCameraPovInterface] Function called.');
    callInterfaceDiv.style.display = 'none';
    loadingScreenDiv.style.display = 'none';
    shotPreviewInterface.style.display = 'none';
    cameraPovInterface.style.display = 'flex';

    if (cameraPovVideo) {
        cameraPovVideo.style.display = 'block';
        cameraPovVideo.style.width = '100%';
        cameraPovVideo.style.height = '100%';
        cameraPovVideo.style.objectFit = 'cover';
        if (recordingIndicator) recordingIndicator.style.display = 'none';
    } else {
        console.error('[showCameraPovInterface] cameraPovVideo element not found!');
    }
}

/**
 * Displays the shot preview interface after a picture is captured.
 */
function showShotPreviewInterface() {
    console.log('[showShotPreviewInterface] Function called.');
    callInterfaceDiv.style.display = 'none';
    loadingScreenDiv.style.display = 'none';
    cameraPovInterface.style.display = 'none';
    shotPreviewInterface.style.display = 'flex';
}

/**
 * Shows the call ended notification modal.
 * @param {string} message - The message to display in the modal.
 * @param {function} callback - The function to execute when the OK button is clicked.
 */
function showCallEndNotification(message, callback) {
    if (callEndedModal && callEndedMessage && callEndedOkBtn) {
        callEndedMessage.textContent = message;
        callEndedModal.style.display = 'flex';
        
        const newOkBtn = callEndedOkBtn.cloneNode(true);
        callEndedOkBtn.parentNode.replaceChild(newOkBtn, callEndedOkBtn);
        
        newOkBtn.addEventListener('click', () => {
            callEndedModal.style.display = 'none';
            if (callback) {
                callback();
            }
        });
    }
}

/**
 * Starts the call timer and updates the display every second.
 */
function startCallTimer() {
    callStartTime = Date.now();
    callTimerInterval = setInterval(() => {
        const elapsedTime = Date.now() - callStartTime;
        const hours = Math.floor(elapsedTime / (1000 * 60 * 60));
        const minutes = Math.floor((elapsedTime % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((elapsedTime % (1000 * 60)) / 1000);

        const formatTime = (time) => String(time).padStart(2, '0');
        callTimerSpan.textContent = `${formatTime(hours)}:${formatTime(minutes)}:${formatTime(seconds)}`;
    }, 1000);
}

/**
 * Stops the call timer and resets its display.
 */
function stopCallTimer() {
    clearInterval(callTimerInterval);
    callTimerSpan.textContent = '00:00:00';
}

/**
 * Formats an ISO string timestamp into a readable time format (e.g., "10:30 AM").
 * @param {string} isoString - The ISO 8601 string timestamp.
 * @returns {string} The formatted time string.
 */
function formatTimestamp(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const formattedHours = hours % 12 === 0 ? 12 : hours % 12;
    const formattedMinutes = minutes < 10 ? '0' + minutes : minutes;
    return `${formattedHours}:${formattedMinutes} ${ampm}`;
}

/**
 * Displays a message in the chat box.
 * @param {string} sender - The name of the message sender.
 * @param {string} message - The message content (used for text messages).
 * @param {boolean} isCurrentUser - True if the message was sent by the current user.
 * @param {string|null} fileUrl - URL of an attached file, if any.
 * @param {string|null} timestamp - ISO string timestamp of the message.
 */
function displayMessage(sender, message, isCurrentUser, fileUrl = null, timestamp = null) {
    const chatBox = document.getElementById('chat-box');
    if (!chatBox) return;

    const messageDiv = document.createElement('div');
    messageDiv.classList.add('chat-message');
    if (isCurrentUser) {
        messageDiv.classList.add('local-message');
    } else {
        messageDiv.classList.add('remote-message');
    }

    const senderInfoDiv = document.createElement('div');
    senderInfoDiv.classList.add('sender-info');

    const senderNameSpan = document.createElement('span');
    senderNameSpan.classList.add('sender-name');
    senderNameSpan.textContent = isCurrentUser ? 'You' : sender;
    senderInfoDiv.appendChild(senderNameSpan);

    if (timestamp) {
        const timestampSpan = document.createElement('span');
        timestampSpan.classList.add('timestamp');
        timestampSpan.textContent = formatTimestamp(timestamp);
        senderInfoDiv.appendChild(timestampSpan);
    }

    messageDiv.appendChild(senderInfoDiv);

    const contentDiv = document.createElement('div');
    contentDiv.classList.add('chat-content');

    if (fileUrl) {
        const fileExtension = fileUrl.split('.').pop().toLowerCase();
        if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(fileExtension)) {
            const imgElement = document.createElement('img');
            imgElement.src = fileUrl;
            imgElement.alt = "Shared Image";
            imgElement.classList.add('chat-image');
            const downloadLink = document.createElement('a');
            downloadLink.href = fileUrl;
            downloadLink.download = `shared_image_${Date.now()}.${fileExtension}`; 
            downloadLink.appendChild(imgElement);
            contentDiv.appendChild(downloadLink);
        } else {
            const fileLink = document.createElement('a');
            fileLink.href = fileUrl;
            fileLink.target = '_blank';
            const fileNameFromUrl = fileUrl.substring(fileUrl.lastIndexOf('/') + 1);
            fileLink.textContent = (message && message !== 'File shared.') ? message : `Download: ${fileNameFromUrl}`; 
            fileLink.classList.add('chat-file-link');
            fileLink.download = fileNameFromUrl;
            contentDiv.appendChild(fileLink);
        }
    } else {
        const messageText = document.createElement('p');
        messageText.textContent = message;
        contentDiv.appendChild(messageText);
    }

    messageDiv.appendChild(contentDiv);
    chatBox.appendChild(messageDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
}

/**
 * Updates the online/offline status and name display of the peer in the chat header.
 * @param {boolean} isPeerConnected - True if a peer is connected, false otherwise.
 * @param {string} [peerName=''] - The name of the connected peer.
 */
function updatePeerStatus(isPeerConnected, peerName = '') {
    if (peerStatusDot && chatPeerNameDisplay) {
        if (isPeerConnected) {
            peerStatusDot.classList.remove('status-offline');
            peerStatusDot.classList.add('status-online');
            chatPeerNameDisplay.textContent = `Chat with ${peerName || 'Peer'}`;
        } else {
            peerStatusDot.classList.remove('status-online');
            peerStatusDot.classList.add('status-offline');
            chatPeerNameDisplay.textContent = 'Waiting for user';
        }
    }
}

/**
 * Stub function for saving chat history. The actual implementation is in `script-logic.js`.
 */
function saveChatHistory() {
    console.log("saveChatHistory function stub in script-base.js called. Actual implementation is in script-logic.js.");
}

// --- MODIFICATION START: Event Listeners for showing/hiding controls on activity ---
function handleUserActivity() {
    // These functions are defined elsewhere in this file
    showMiniVideo();
    resetControlTabTimer();
}

// Listen for mouse movement on desktop
document.addEventListener('mousemove', handleUserActivity);

// Listen for clicks
document.addEventListener('click', handleUserActivity);

// Listen for touches on mobile
document.addEventListener('touchstart', (event) => {
    // Don't trigger on UI element interactions
    if (event.target.closest('button, input, a, video, .chat-container')) {
        return;
    }
    handleUserActivity();
}, { passive: true });


// Prevent clicks on mini video itself from immediately re-hiding it by resetting timer
if (miniVideoContainer) {
    miniVideoContainer.addEventListener('click', (event) => {
        event.stopPropagation();
        resetMiniVideoHideTimer();
    });
    miniVideoContainer.addEventListener('touchstart', (event) => {
        event.stopPropagation();
        resetMiniVideoHideTimer();
    }, { passive: true });
}
// --- MODIFICATION END ---


// MODIFIED: Initial setup for UI elements after page load
document.addEventListener('DOMContentLoaded', () => {
    updatePeerStatus(false);
    if (typingIndicator) {
        typingIndicator.style.display = 'none';
    }

    // MODIFIED: Show controls on load, then start hide timer
    resetControlTabTimer(); 

    if (miniVideo) {
        miniVideo.addEventListener('loadedmetadata', () => {
            if (!miniVideoContainer.classList.contains('mini-preview-hidden') && miniVideo.paused) {
                miniVideo.play().catch(e => {
                    if (e.name === 'AbortError') {
                        console.warn('Mini video play AbortError (from loadedmetadata, often expected):', e.message);
                    } else {
                        console.error('Mini video play error after loadedmetadata:', e);
                    }
                });
            }
        });
        miniVideo.addEventListener('emptied', () => {
            if (!miniVideo.paused) {
                miniVideo.pause();
            }
        });
        miniVideo.addEventListener('play', () => console.log('[MiniVideo_Trace] miniVideo PLAY event fired!'));
        miniVideo.addEventListener('pause', () => console.log('[MiniVideo_Trace] miniVideo PAUSE event fired!'));
        miniVideo.addEventListener('ended', () => console.log('[MiniVideo_Trace] miniVideo ENDED event fired!'));
    }

    resetMiniVideoHideTimer();
});
script-base.js