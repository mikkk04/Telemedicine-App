// NOTE: This file depends on DOM elements and global variables defined in script-base.js
// It MUST be loaded AFTER script-base.js in your HTML.
'use strict'; // Added strict mode for better code quality and error prevention

const peerConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
    ]
};

const socket = io();
setupSocketEventListeners();

// This function is a stub, as the buttons it controls are no longer present on this page.
function setRoomSelectionButtonsState(disabled) {
    // This function is now a stub as the buttons it controlled were on a different page.
}

let chatDataChannel = null;

let isGettingStream = false;

// Global Map to store peerId -> username mapping
const remoteUsernames = new Map();
let currentUserRole = null;

// Variables for Puppy Icon (stubbed out)
let puppyIcon; 
const PUPPY_ICON_SIZE = 80;

// --- Camera Switching Variables ---
let availableVideoDevices = []; // To store MediaDeviceInfo for all video inputs
let currentCameraIndex = 0; // Index of the currently active camera in availableVideoDevices
let currentFacingMode = 'user'; // 'user' (front), 'environment' (rear), or 'unknown'

// --- Video Recording Variables (NEW) ---
let mediaRecorder; // MediaRecorder instance
let recordedChunks = []; // Array to store video data chunks
let longPressTimer; // setTimeout ID for long press detection
let isLongPress = false; // Flag to differentiate long vs. short press
const RECORDING_THRESHOLD_MS = 500; // 0.5 seconds to consider a long press
let isRecording = false; // Flag to indicate if recording is active
let currentPreviewBlob = null; // Stores the Blob for the current image or video preview
let currentPreviewUrl = null; // Stores the URL.createObjectURL for the current preview
let currentPreviewType = 'none'; // 'none', 'image', or 'video'

// Function to move the puppy (stubbed)
function movePuppy() {
    // Stub
}

/**
 * Applies horizontal mirroring to a video element based on camera facing mode.
 * @param {HTMLVideoElement} videoElement The video element to transform.
 * @param {string} facingMode The facing mode ('user', 'environment', or 'unknown').
 */
function applyVideoTransform(videoElement, facingMode) {
    if (!videoElement) return;
    if (facingMode === 'user') {
        videoElement.style.transform = 'scaleX(-1)'; // Mirror for front camera
    } else {
        videoElement.style.transform = 'none'; // No mirror for rear or unknown
    }
    console.log(`[Camera_Switch] Applied transform for ${videoElement.id}: ${videoElement.style.transform} (Facing Mode: ${facingMode})`);
}


// FULL FUNCTIONAL VERSION: Restores camera enumeration and selection
async function getLocalStream(targetFacingMode = currentFacingMode) {
    console.log('[LocalStream_Trace] getLocalStream called. Requesting media access.');
    isGettingStream = true;
    setRoomSelectionButtonsState(true); // Disable buttons while getting stream

    let constraints = { video: true, audio: true }; // Default to generic access

    try {
        // Enumerate devices to get specific camera IDs and labels
        // NOTE: enumerateDevices often returns empty labels until getUserMedia is called once.
        // We will call it again later if needed.
        let devices = await navigator.mediaDevices.enumerateDevices();
        availableVideoDevices = devices.filter(d => d.kind === 'videoinput');
        console.log('[Camera_Switch] Found video devices (pre-access):', availableVideoDevices.length);

        // Try to get a specific camera based on targetFacingMode or initial preference
        let selectedDevice = null;
        if (availableVideoDevices.length > 0 && availableVideoDevices[0].label !== '') {
             if (targetFacingMode === 'user') {
                 selectedDevice = availableVideoDevices.find(d => d.label.toLowerCase().includes('front') || d.facingMode === 'user');
             } else if (targetFacingMode === 'environment') {
                 selectedDevice = availableVideoDevices.find(d => d.label.toLowerCase().includes('back') || d.facingMode === 'environment');
             }
             if (!selectedDevice && targetFacingMode !== 'user') {
                 selectedDevice = availableVideoDevices.find(d => d.label.toLowerCase().includes('front') || d.facingMode === 'user');
             }
             if (!selectedDevice) {
                 selectedDevice = availableVideoDevices.find(d => d.label.toLowerCase().includes('back') || d.facingMode === 'environment');
             }
            
             if (selectedDevice) {
                 constraints.video = { deviceId: { exact: selectedDevice.deviceId } };
                 currentCameraIndex = availableVideoDevices.findIndex(d => d.deviceId === selectedDevice.deviceId);
             }
        }
        
        // Fallback constraint if device selection failed or devices not enumerated yet
        if (!constraints.video.deviceId) {
             constraints.video = { facingMode: targetFacingMode };
        }
        
        console.log('[LocalStream_Trace] Calling getUserMedia with constraints:', JSON.stringify(constraints));
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        
        console.log('[LocalStream_Trace] getUserMedia successful. Received localStream object:', localStream);
        
        // --- RE-ENUMERATE DEVICES AFTER PERMISSION ---
        // This ensures labels are visible and switch button logic works
        devices = await navigator.mediaDevices.enumerateDevices();
        availableVideoDevices = devices.filter(d => d.kind === 'videoinput');
        console.log('[Camera_Switch] Found video devices (post-access):', availableVideoDevices.map(d => d.label));

        if (switchCamPovBtn) {
            if (availableVideoDevices.length > 1) {
                switchCamPovBtn.disabled = false;
                console.log('[Camera_Switch] Multiple cameras found, enabling switch button.');
            } else {
                switchCamPovBtn.disabled = true;
                console.log('[Camera_Switch] Only one or no cameras, disabling switch button.');
            }
        }

        // --- Diagnostic checks for the acquired stream ---
        if (!localStream) {
            throw new Error("getUserMedia returned null/undefined stream.");
        }
        if (localStream.getVideoTracks().length > 0) {
            const videoTrack = localStream.getVideoTracks()[0];
            const settings = videoTrack.getSettings();
            currentFacingMode = settings.facingMode || 'unknown'; // Update currentFacingMode from actual settings
            console.log(`[LocalStream_Trace] Facing mode: ${currentFacingMode}`);
        }

        // Initially set the chat input/send button states here
        sendChatBtn.disabled = false;
        chatInput.disabled = false;

        // Determine initial video display based on whether there are existing peers
        if (peerConnections.size === 0) {
            displayLocalStreamInMain(); // No peers yet, local stream goes to main
        } else {
            displayLocalStreamInMini(); // Peers exist, local stream goes to mini
        }
        toggleMicBtn.classList.add('active');
        toggleCamBtn.classList.add('active');

    } catch (error) {  
        console.error('[LocalStream_Trace] Error getting local stream:', error);
        alert('Could not get access to camera/microphone. Please check permissions.');
        window.location.href = '/'; 
        return null;
    } finally {
        isGettingStream = false;
        // Apply initial transform to both preview videos
        applyVideoTransform(cameraPovVideo, currentFacingMode);
        applyVideoTransform(miniVideo, currentFacingMode);
    }
    return localStream;
}

/**
 * Replaces the video track on all active peer connections.
 * This is crucial for smoothly switching cameras during a call.
 * @param {MediaStreamTrack} newVideoTrack The new video track to send.
 */
async function replaceVideoTrackOnPeers(newVideoTrack) {
    console.log('[WebRTC] Attempting to replace video track on peer connections...');
    if (!newVideoTrack) return;

    for (const [peerId, pc] of peerConnections.entries()) {
        const senders = pc.getSenders();
        const videoSender = senders.find(sender => sender.track && sender.track.kind === 'video');

        if (videoSender) {
            try {
                await videoSender.replaceTrack(newVideoTrack);
                console.log(`[WebRTC] Successfully replaced video track for peer: ${peerId}`);
            } catch (error) {
                console.error(`[WebRTC] Error replacing video track for peer ${peerId}:`, error);
            }
        }
    }
}


/**
 * Sets the local stream to the main video element (used when no remote peer is connected).
 */
function displayLocalStreamInMain() {
    if (miniVideo.srcObject) {
        miniVideo.srcObject = null;
    }
    miniVideoNameLabel.textContent = ''; 
    hideMiniVideo(); 

    mainVideo.srcObject = localStream;
    applyVideoTransform(mainVideo, currentFacingMode);  
    mainVideo.muted = true; 
    mainVideoNameLabel.textContent = currentUsername || 'You';
    mainVideo.play().catch(e => console.warn('Main video play error:', e)); 

    remoteStream = new MediaStream(); 
    console.log('Local video set to main frame. Mini hidden.');
}

/**
 * Sets the local stream to the mini video element and attempts to set remote stream to main video.
 */
function displayLocalStreamInMini() {
    if (mainVideo.srcObject === localStream) {
        mainVideo.srcObject = null;
    }
    mainVideoNameLabel.textContent = 'Connecting...'; 

    if (miniVideo.srcObject !== localStream) { 
        miniVideo.srcObject = localStream;
        applyVideoTransform(miniVideo, currentFacingMode);      
        miniVideo.muted = true; 
        miniVideoNameLabel.textContent = currentUsername || 'You';
        miniVideo.play().catch(e => console.warn('Mini video play error:', e));
    }
    showMiniVideo(); 

    if (remoteStream && remoteStream.getTracks().length > 0) {
        if (mainVideo.srcObject !== remoteStream) { 
            mainVideo.srcObject = remoteStream;
            mainVideo.style.transform = 'none'; 
            mainVideo.muted = false; 
            mainVideo.play().catch(e => console.warn('Remote main play error:', e));
        }
        
        const remotePeerId = Array.from(peerConnections.keys())[0]; 
        if (remotePeerId) {
            const remoteUsername = remoteUsernames.get(remotePeerId);
            if (remoteUsername) {
                mainVideoNameLabel.textContent = remoteUsername;
                updatePeerStatus(true, remoteUsername);
            }
        } else {
            mainVideoNameLabel.textContent = 'Remote Peer';
        }
    } else {
        if (mainVideo.srcObject !== null) {
            mainVideo.srcObject = null;
        }
    }
}


function createPeerConnection(peerId, isInitiator = false) {
    console.log(`[WebRTC] Creating RTCPeerConnection for peerId: ${peerId}`);
    const peerConnection = new RTCPeerConnection(peerConfig);

    peerConnections.set(peerId, peerConnection);

    if (localStream) {
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
    }

    if (isInitiator) {
        chatDataChannel = peerConnection.createDataChannel("chat");
        setupDataChannelListeners(chatDataChannel, peerId);
    }

    peerConnection.ondatachannel = (event) => {
        if (event.channel.label === "chat") {
            chatDataChannel = event.channel;
            setupDataChannelListeners(chatDataChannel, peerId);
        }
    };


    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('webrtc:ice-candidate', {
                candidate: event.candidate,
                targetSocketId: peerId,
                room: currentRoomId
            });
        }
    };

    peerConnection.ontrack = (event) => {
        if (!remoteStream.getTrackById(event.track.id)) {
            remoteStream.addTrack(event.track);
        }

        if (peerConnections.size > 0 && localStream && remoteStream && remoteStream.getTracks().length > 0) {
            displayLocalStreamInMini();
        } else {
            displayLocalStreamInMain();
        }

        const remotePeerId = Array.from(peerConnections.keys())[0];
        const remoteUsername = remoteUsernames.get(remotePeerId) || `Peer (${remotePeerId.substring(0, 6)})`;
        mainVideoNameLabel.textContent = remoteUsername; 
        updatePeerStatus(true, remoteUsername); 
    };


    peerConnection.oniceconnectionstatechange = () => {
        if (peerConnection.iceConnectionState === 'failed' || peerConnection.iceConnectionState === 'disconnected') {
            const disconnectedUsername = remoteUsernames.get(peerId) || `Peer (${peerId.substring(0, 6)})`;
            mainVideoNameLabel.textContent = `${disconnectedUsername} (Disconnected)`;
            if (peerConnections.size === 1) updatePeerStatus(false); 
        } else if (peerConnection.iceConnectionState === 'connected') {
            if (mainVideo.srcObject === remoteStream) {  
                mainVideoNameLabel.textContent = remoteUsernames.get(peerId) || 'Remote Peer';
            }
        }
    };

    peerConnection.onconnectionstatechange = () => {
        if (peerConnection.connectionState === 'disconnected' || peerConnection.connectionState === 'failed') {
            if (peerConnections.size === 1) {
                updatePeerStatus(false); 
            }
            if (mainVideo.srcObject === remoteStream) {
                const disconnectedUsername = remoteUsernames.get(peerId) || `Peer (${peerId.substring(0, 6)})`;
                mainVideoNameLabel.textContent = `${disconnectedUsername} (Disconnected)`;
            }
        } else if (peerConnection.connectionState === 'connected') {
            const connectedUsername = remoteUsernames.get(peerId);
            if (connectedUsername && mainVideo.srcObject === remoteStream) {
                mainVideoNameLabel.textContent = connectedUsername;
                updatePeerStatus(true, connectedUsername);
            }
        }
    };

    return peerConnection;
}


async function handleOffer(offer, senderId, senderUsername) {
    remoteUsernames.set(senderId, senderUsername);
    const peerConnection = createPeerConnection(senderId, false);
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    socket.emit('webrtc:answer', {
        answer: answer,
        targetSocketId: senderId,
        room: currentRoomId,
        username: currentUsername 
    });

    if (peerConnections.size === 1 && remoteStream && remoteStream.getTracks().length > 0) {
        mainVideoNameLabel.textContent = senderUsername;
        updatePeerStatus(true, senderUsername); 
    }
}

async function handleAnswer(answer, senderId, senderUsername) {
    remoteUsernames.set(senderId, senderUsername);
    const peerConnection = peerConnections.get(senderId);
    if (peerConnection) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        if (mainVideo.srcObject === remoteStream) {
            mainVideoNameLabel.textContent = senderUsername;
            updatePeerStatus(true, senderUsername); 
        }
    }
}

function handleCandidate(candidate, senderId) {
    const peerConnection = peerConnections.get(senderId);
    if (peerConnection) {
        peerConnection.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.error);
    }
}

function setupDataChannelListeners(channel) {
    channel.onopen = () => console.log('[DataChannel] Open!');
    channel.onmessage = (event) => {
        try {
            const payload = JSON.parse(event.data);
            if (payload.type === 'chatMessage') {
                handleTypingIndicatorForDataChannel(false); 
            } else if (payload.type === 'typing') {
                handleTypingIndicatorForDataChannel(payload.isTyping, payload.sender);
            }
        } catch (e) {
            console.error('Failed to parse Data Channel message:', e);
        }
    };
}

function handleTypingIndicatorForDataChannel(isTyping, senderName = 'Peer') {
    const typingIndicatorElement = document.getElementById('typingIndicator');
    if (!typingIndicatorElement) return;

    if (isTyping) {
        typingIndicatorElement.textContent = `${senderName} is typing...`;
        typingIndicatorElement.style.display = 'block';
        clearTimeout(remoteTypingDisplayTimeout);
        remoteTypingDisplayTimeout = setTimeout(() => {
            typingIndicatorElement.style.display = 'none';
        }, REMOTE_TYPING_DISPLAY_DURATION);
    } else {
        typingIndicatorElement.style.display = 'none';
        clearTimeout(remoteTypingDisplayTimeout);
    }
}


function setupSocketEventListeners() {
    socket.on('connect', async () => {
        console.log('[Socket.IO] Connected. Socket ID:', socket.id);
        
        let localUsername = localStorage.getItem('telemedicine_user');
        
        const urlParams = new URLSearchParams(window.location.search);
        const pathParts = window.location.pathname.split('/');
        currentRoomId = pathParts[pathParts.length - 1];
        
        const authToken = urlParams.get('token');
        
        socket.emit('user:online', { username: localUsername });

        if (!currentRoomId || !localUsername || !authToken) {
            alert("Error: You must be logged in and join from a valid dashboard link.");
            window.location.href = '/';
            return;
        }

        showLoadingScreen();
        const stream = await getLocalStream();
        if (stream) {
            socket.emit('auth:join-room', { room: currentRoomId, username: localUsername, token: authToken });
        } else {
            alert("Failed to get local media stream. Cannot join meeting.");
            window.location.href = '/';
        }
    });

    socket.on('error', (errorMessage) => {
        alert(`An error occurred: ${errorMessage}`);
        window.location.href = '/';
    });
    
    socket.on('connect_error', (error) => {
        alert('Failed to connect to the signaling server. Please try again.');
        window.location.href = '/';
    });
    
    socket.on('auth:failed', (message) => {
        alert(`Authentication Failed: ${message}`);
        window.location.href = '/';
    });

    socket.on('room:created', (data) => {
        if (data.user) {
            currentUsername = data.user.username;
            currentUserRole = data.user.role;
            mainVideoNameLabel.textContent = `${currentUsername} - ${currentUserRole}`;
            miniVideoNameLabel.textContent = `${currentUsername} - ${currentUserRole}`;
        }

        currentRoomId = data.room;
        activeRoomCodeSpan.textContent = currentRoomId;
        showCallInterface();
        startCallTimer();
        displayLocalStreamInMain();
        displayMessage('System', `You created and joined room: ${currentRoomId}`, true, null, new Date().toISOString());
    });
    
    socket.on('room:joined', async (data) => {
        if (data.user) {
            currentUsername = data.user.username;
            currentUserRole = data.user.role;
            mainVideoNameLabel.textContent = `Connecting to ${data.usersInRoom[0]?.username || 'Peer'}...`;
            miniVideoNameLabel.textContent = `${currentUsername} - ${currentUserRole}`;
        }

        currentRoomId = data.room;
        activeRoomCodeSpan.textContent = currentRoomId;
        showCallInterface();
        startCallTimer();
        displayLocalStreamInMini();
        
        displayMessage('System', `You joined room: ${currentRoomId}`, true, null, new Date().toISOString());
        
        if (data.usersInRoom && data.usersInRoom.length > 0) {
            data.usersInRoom.forEach(user => {
                if (user.username !== currentUsername) {
                    remoteUsernames.set(user.id, user.username);
                    handleExistingPeer(user.id, user.username); 
                }
            });
        }
        
        if (data.chatHistory && Array.isArray(data.chatHistory)) {
            data.chatHistory.forEach(msg => {
                displayMessage(msg.username, msg.message, msg.username === currentUsername, msg.fileUrl, msg.timestamp);
            });
            chatBox.scrollTop = chatBox.scrollHeight;
        }
    });

    socket.on('room:not-found', () => {
        alert('The requested room does not exist. It may have been closed.');
        window.location.href = '/';
    });

    socket.on('room:full', () => {
        alert('The room you tried to join is full.');
        window.location.href = '/';
    });

    socket.on('user:joined', (data) => {
        if (data.id !== socket.id && !peerConnections.has(data.id)) {
            
            const peerUsername = data.username;
            remoteUsernames.set(data.id, peerUsername);
            
            updatePeerStatus(true, peerUsername);
            displayMessage('System', `${peerUsername} has joined.`, false, null, new Date().toISOString());

            handleNewPeer(data.id, peerUsername);
            displayLocalStreamInMini();

        }
    });

    socket.on('user:left', (data) => {
        displayMessage('System', `${data.username} has left the call.`, false, null, new Date().toISOString());
        if (peerConnections.has(data.id)) {
            peerConnections.get(data.id).close();
            peerConnections.delete(data.id);
            remoteUsernames.delete(data.id);
        }
        stopMediaStream(remoteStream);
        remoteStream = new MediaStream();
        displayLocalStreamInMain();
        mainVideoNameLabel.textContent = `${currentUsername} - You`;
        updatePeerStatus(false);
    });

    socket.on('call:end', (data) => {
        const userRole = currentUserRole;
        showCallEndNotification(
            data.message || "The call has ended.",
            () => {
                if (userRole === 'Patient') {
                    window.location.href = '/patient-dashboard.html';
                } else if (userRole === 'Doctor') {
                    window.location.href = '/doctor-dashboard.html';
                } else {
                    window.location.href = '/';
                }
            }
        );
        resetCallUI(); 
    });

    socket.on('webrtc:offer', (data) => handleOffer(data.offer, data.senderSocketId, data.senderUsername));
    socket.on('webrtc:answer', (data) => handleAnswer(data.answer, data.senderSocketId, data.senderUsername));
    socket.on('webrtc:ice-candidate', (data) => handleCandidate(data.candidate, data.senderSocketId));
    
    socket.on('chat:message', (data) => {
        const isCurrentUser = data.username === currentUsername;
        displayMessage(data.username, data.message, isCurrentUser, data.fileUrl, data.timestamp);
    });
    
    socket.on('chat:typing', (data) => {
        if (data.username !== currentUsername) {
            handleTypingIndicatorForDataChannel(data.isTyping, data.username);
        }
    });

    socket.on('get:peer:username:response', (data) => {
        if (data.peerId && data.username) {
            remoteUsernames.set(data.peerId, data.username);
            const remotePeerIdOnMain = Array.from(peerConnections.keys()).find(id => peerConnections.get(id) && mainVideo.srcObject === remoteStream);
            if (remotePeerIdOnMain === data.peerId) {
                mainVideoNameLabel.textContent = data.username;
                updatePeerStatus(true, data.username);
            }
        }
    });

    socket.on('disconnect', (reason) => {
        const isIntentional = (reason === 'io client disconnect' || reason === 'transport close');
    
        const isRedirecting = (
            window.location.pathname.includes('/patient-dashboard.html') ||
            window.location.pathname.includes('/doctor-dashboard.html') ||
            window.location.pathname === '/'
        );
    
        if (!isIntentional && !isRedirecting) {
            showCallEndNotification(
                'Connection lost unexpectedly. Please check your network and try again.',
                () => {
                    window.location.href = '/'; 
                }
            );
            resetCallUI();
        }
    });

    async function handleNewPeer(peerId, peerUsername) {
        remoteUsernames.set(peerId, peerUsername);

        const peerConnection = createPeerConnection(peerId, true);
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        socket.emit('webrtc:offer', {
            offer: offer,
            targetSocketId: peerId,
            room: currentRoomId,
            username: currentUsername
        });
        mainVideoNameLabel.textContent = `Connecting to ${peerUsername}...`;
        updatePeerStatus(true, peerUsername);
    }
    
    async function handleExistingPeer(peerId, peerUsername) {
        const peerConnection = createPeerConnection(peerId, true);
        
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        
        socket.emit('webrtc:offer', {
            offer: offer,
            targetSocketId: peerId,
            room: currentRoomId,
            username: currentUsername
        });
        mainVideoNameLabel.textContent = `Connecting to ${peerUsername}...`;
        updatePeerStatus(true, peerUsername);
    }
} 

/**
 * Stops all tracks in a given media stream.
 * @param {MediaStream} stream The stream whose tracks should be stopped.
 */
function stopMediaStream(stream) {
    if (stream) {
        stream.getTracks().forEach(track => {
            track.stop();
        });
    }
}

/**
 * REFACTORED: Switches the local camera and correctly updates all relevant video elements.
 */
async function switchCamera() {
    console.log('[Camera_Switch] switchCamera called.');
    if (!localStream || availableVideoDevices.length <= 1) {
        alert('Cannot switch camera. Please ensure camera is active and more than one camera is available.');
        return;
    }

    // Stop current local stream tracks to release the camera
    stopMediaStream(localStream);

    // Determine the next camera to use
    currentCameraIndex = (currentCameraIndex + 1) % availableVideoDevices.length;
    const nextDevice = availableVideoDevices[currentCameraIndex];

    const newConstraints = {
        video: {
            deviceId: { exact: nextDevice.deviceId }
        },
        audio: true
    };
    
    // Add facingMode hint if available
    if (nextDevice.facingMode) {
        newConstraints.video.facingMode = { exact: nextDevice.facingMode };
    }

    try {
        const newStream = await navigator.mediaDevices.getUserMedia(newConstraints);
        localStream = newStream; 

        const newVideoTrack = newStream.getVideoTracks()[0];
        if (newVideoTrack) {
            const settings = newVideoTrack.getSettings();
            currentFacingMode = settings.facingMode || 'unknown';
            console.log('[Camera_Switch] New camera acquired. Facing:', currentFacingMode);
        } else {
            currentFacingMode = 'unknown';
        }

        // Update all elements
        cameraPovVideo.srcObject = localStream;
        miniVideo.srcObject = localStream;

        if (peerConnections.size === 0) {
            mainVideo.srcObject = localStream;
        }

        // Play updated elements
        cameraPovVideo.play().catch(e => console.warn(e));
        miniVideo.play().catch(e => console.warn(e));
        if (peerConnections.size === 0) {
             mainVideo.play().catch(e => console.warn(e));
        }

        // Apply correct mirroring transform
        applyVideoTransform(cameraPovVideo, currentFacingMode);
        applyVideoTransform(miniVideo, currentFacingMode);
        if (peerConnections.size === 0) {
            applyVideoTransform(mainVideo, currentFacingMode);
        }

        // Send the new video track to all connected peers
        await replaceVideoTrackOnPeers(newVideoTrack);

    } catch (error) {
        console.error('[Camera_Switch] Error switching camera:', error);
        alert('Failed to switch camera.');
        // Attempt to re-acquire a default stream
        await getLocalStream();
    }
}

/**
 * Clears the shot preview interface.
 */
function clearPreview() {
    if (currentPreviewUrl) {
        URL.revokeObjectURL(currentPreviewUrl);
        currentPreviewUrl = null;
    }
    capturedShotImage.style.display = 'none';
    capturedShotImage.src = '';
    capturedVideoPreview.style.display = 'none';
    capturedVideoPreview.src = '';
    capturedVideoPreview.pause(); 
    currentPreviewBlob = null;
    currentPreviewType = 'none';
}

function dataURLtoBlob(dataurl) {
    try {
        const arr = dataurl.split(',');
        if (arr.length < 2) return null;

        const mimeMatch = arr[0].match(/:(.*?);/);
        if (!mimeMatch || mimeMatch.length < 2) return null;
        
        const mime = mimeMatch[1];
        const bstr = atob(arr[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        
        while (n--) {
            u8arr[n] = bstr.charCodeAt(n);
        }
        
        return new Blob([u8arr], { type: mime });
    } catch (error) {
        console.error("Error in dataURLtoBlob:", error);
        return null;
    }
}

/**
 * Handles taking a single picture.
 */
function capturePicture() {
    if (!cameraPovVideo || !cameraPovVideo.srcObject) { 
        alert("Camera stream not available. Cannot capture picture.");
        return;
    }

    const { videoWidth, videoHeight } = cameraPovVideo;
    hiddenPhotoCanvas.width = videoWidth;
    hiddenPhotoCanvas.height = videoHeight;
    const context = hiddenPhotoCanvas.getContext('2d');
    
    if (context) {
        // Apply the same transform as the video is showing
        const transform = cameraPovVideo.style.transform;
        if (transform === 'scaleX(-1)') {
            context.translate(videoWidth, 0);
            context.scale(-1, 1);
        }
        context.drawImage(cameraPovVideo, 0, 0, videoWidth, videoHeight);
        
        if (transform === 'scaleX(-1)') {
            context.setTransform(1, 0, 0, 1, 0, 0); 
        }

        const imageDataUrl = hiddenPhotoCanvas.toDataURL('image/png');
        const blob = dataURLtoBlob(imageDataUrl);

        if (blob) {
            currentPreviewBlob = blob;
            currentPreviewUrl = imageDataUrl;
            capturedShotImage.src = currentPreviewUrl;
            capturedShotImage.style.display = 'block';
            capturedVideoPreview.style.display = 'none';
            capturedVideoPreview.pause();
            currentPreviewType = 'image';
            showShotPreviewInterface();
        } else {
            alert('Failed to process image.');
        }

    }
}

/**
 * Starts video recording.
 */
function startRecording() {
    if (!localStream || !localStream.active) {
        alert('No camera stream available to record.');
        return;
    }
    if (isRecording) return;

    const videoTracks = localStream.getVideoTracks();
    const audioTracks = localStream.getAudioTracks();

    if (videoTracks.length === 0) {
        alert('Cannot record: Video track is missing.');
        return;
    }

    const streamForRecorder = new MediaStream([...videoTracks, ...audioTracks]);

    isRecording = true;
    if (recordingIndicator) recordingIndicator.style.display = 'flex';
    if (captureShotBtn) captureShotBtn.classList.add('recording');

    recordedChunks = [];
    try {
        let options = { mimeType: 'video/webm' };
        if (MediaRecorder.isTypeSupported('video/webm; codecs=vp8')) {
            options = { mimeType: 'video/webm; codecs=vp8' };
        } else if (MediaRecorder.isTypeSupported('video/mp4')) {
            options = { mimeType: 'video/mp4' };
        }
        
        mediaRecorder = new MediaRecorder(streamForRecorder, options);

        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                recordedChunks.push(event.data);
            }
        };

        mediaRecorder.onstop = handleRecordingStop;
        mediaRecorder.onerror = (event) => {
            alert(`Video recording error: ${event.error.name}.`);
            stopRecordingInternal();
        };

        mediaRecorder.start();
    } catch (e) {
        console.error('[Camera] Failed to create MediaRecorder:', e);
        stopRecordingInternal();
    }
}

function stopRecordingInternal() {
    isRecording = false;
    if (recordingIndicator) recordingIndicator.style.display = 'none';
    if (captureShotBtn) captureShotBtn.classList.remove('recording');
}

/**
 * Stops video recording.
 */
function stopRecording() {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
    if (isRecording) {
        mediaRecorder.stop();
        stopRecordingInternal();
    }
}

/**
 * Handles the completion of video recording.
 */
function handleRecordingStop() {
    if (recordedChunks.length === 0) {
        alert('No video recorded.');
        return;
    }

    const mimeType = mediaRecorder.mimeType;
    currentPreviewBlob = new Blob(recordedChunks, { type: mimeType });
    recordedChunks = []; 

    if (currentPreviewBlob.size === 0) {
        alert('Recorded video is empty.');
        return;
    }

    currentPreviewUrl = URL.createObjectURL(currentPreviewBlob); 
    currentPreviewType = 'video';

    capturedShotImage.style.display = 'none';
    capturedShotImage.src = '';
    capturedVideoPreview.src = currentPreviewUrl;
    capturedVideoPreview.style.display = 'block';
    capturedVideoPreview.controls = true; 
    capturedVideoPreview.loop = true; 
    capturedVideoPreview.play().catch(e => console.warn(e));

    showShotPreviewInterface(); 
}


// --- Event Listeners for UI Actions ---

toggleMicBtn.addEventListener('click', () => {
    if (localStream) {
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            toggleMicBtn.classList.toggle('active', audioTrack.enabled);
            toggleMicBtn.querySelector('i').className = audioTrack.enabled ? 'fas fa-microphone' : 'fas fa-microphone-slash';
        }
    }
});

toggleCamBtn.addEventListener('click', () => {
    if (localStream) {
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = !videoTrack.enabled;
            toggleCamBtn.classList.toggle('active', videoTrack.enabled);
            toggleCamBtn.querySelector('i').className = videoTrack.enabled ? 'fas fa-video' : 'fas fa-video-slash';
        }
    }
});

endCallBtn.addEventListener('click', () => {
    socket.emit('call:end');
    const userRole = currentUserRole;
    showCallEndNotification(
        "The call has ended.",
        () => {
            if (userRole === 'Patient') {
                window.location.href = '/patient-dashboard.html';
            } else if (userRole === 'Doctor') {
                window.location.href = '/doctor-dashboard.html';
            } else {
                window.location.href = '/';
            }
        }
    );
    resetCallUI(); 
    socket.disconnect(); 
});

function resetCallUI() {
    stopMediaStream(localStream); 
    localStream = null;
    
    peerConnections.forEach(pc => pc.close());
    peerConnections.clear();
    remoteUsernames.clear(); 
    remoteStream = new MediaStream(); 
    if (mainVideo) mainVideo.srcObject = null; 
    if (miniVideo) miniVideo.srcObject = null; 
    currentRoomId = null; 
    currentUsername = null; 
    currentUserRole = null; 
    if (chatBox) chatBox.innerHTML = ''; 

    stopCallTimer(); 
    updatePeerStatus(false);      
    hideMiniVideo(); 

    // Reset camera state variables
    availableVideoDevices = [];
    currentCameraIndex = 0;
    currentFacingMode = 'user'; 
    if (switchCamPovBtn) switchCamPovBtn.disabled = true; 

    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
    recordedChunks = [];
    stopRecordingInternal();
    clearPreview(); 
}


mainVideoContainer.addEventListener('dblclick', () => {
    switchCamera();
    if (peerConnections.size > 0 && miniVideoContainer.classList.contains('mini-preview-hidden')) {
        showMiniVideo();
    }
});

let lastTap = 0;
mainVideoContainer.addEventListener('touchend', (e) => {
    const currentTime = new Date().getTime();
    const tapLength = currentTime - lastTap;
    if (tapLength < 300 && tapLength > 0) {
        e.preventDefault(); 
        switchCamera(); 
        if (peerConnections.size > 0 && miniVideoContainer.classList.contains('mini-preview-hidden')) {
            showMiniVideo();
        }
        lastTap = 0; 
    } else {
        lastTap = currentTime;
    }
});

// 📌 FIX: Changed from 'chat-open' to 'active' to match mobile CSS toggle logic.
toggleChatBtn.addEventListener('click', () => chatContainer.classList.toggle('active'));
exitChatBtn.addEventListener('click', () => chatContainer.classList.remove('active'));

// Optional: Add ESC key listener to close chat
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && chatContainer.classList.contains('active')) {
        chatContainer.classList.remove('active');
        chatInput.focus();
    }
});

function emitTypingStatus(isTyping) {
    const payload = { type: 'typing', isTyping, sender: currentUsername, senderId: socket.id };
    if (chatDataChannel && chatDataChannel.readyState === 'open') {
        chatDataChannel.send(JSON.stringify(payload));
    } else if (socket.connected && currentRoomId) {
        socket.emit('chat:typing', { ...payload, room: currentRoomId });
    }
}

if (chatInput) {
    chatInput.addEventListener('input', () => {
        if (chatInput.value.trim().length > 0) {
            if (!typingTimeout) emitTypingStatus(true); 
            clearTimeout(typingTimeout);
            typingTimeout = setTimeout(() => {
                emitTypingStatus(false); 
                typingTimeout = null;
            }, TYPING_TIMEOUT_DELAY);
        } else {
            clearTimeout(typingTimeout);
            emitTypingStatus(false);
            typingTimeout = null;
        }
    });
}

function clearFileInput(inputElement) {
    if (inputElement) {
        inputElement.removeEventListener('change', handleFileInputChange);
        try {
            inputElement.files = null;  
        } catch (e) {}
        inputElement.value = ''; 
        setTimeout(() => {
            inputElement.addEventListener('change', handleFileInputChange);
        }, 0);
    }
}

function handleFileInputChange(event) {
    const file = event.target.files[0];
    if (file) {
        selectedFileForUpload = file;
        chatInput.value = `File: ${file.name}`; 
        chatInput.focus(); 
    } else {
        selectedFileForUpload = null;
        chatInput.value = '';
        clearFileInput(fileInput);  
    }
}


sendChatBtn.addEventListener('click', async () => {
    const message = chatInput.value.trim();
    if (typingTimeout) clearTimeout(typingTimeout);
    emitTypingStatus(false); 

    if (!socket.connected || !currentRoomId) {
        return;
    }

    let fileToUpload = selectedFileForUpload;
    let fileName = fileToUpload?.name || 'File shared.';

    if (currentPreviewBlob) {
        fileToUpload = currentPreviewBlob;
        if (currentPreviewType === 'image') {
            fileName = `photo_${Date.now()}.png`; 
        } else if (currentPreviewType === 'video') {
            fileName = `video_${Date.now()}.webm`; 
        }
    }

    if (fileToUpload) {
        try {
            const formData = new FormData();
            formData.append('file', fileToUpload, fileName);

            const response = await fetch('/upload', { method: 'POST', body: formData });  
            
            if (response.ok) {
                const data = await response.json();
                
                const payload = {
                    type: 'chatMessage',
                    message: message || fileName,
                    fileUrl: data.url,
                    timestamp: new Date().toISOString(),
                    sender: currentUsername,
                    senderId: socket.id
                };

                socket.emit('chat:message', { ...payload, room: currentRoomId });
                if (chatDataChannel && chatDataChannel.readyState === 'open') {
                    chatDataChannel.send(JSON.stringify(payload));
                }

            } else {
                alert('File upload failed. Server error.');
            }
        } catch (error) {
            alert('File upload failed due to a network or client error.');
        } finally {
            selectedFileForUpload = null;
            chatInput.value = '';
            clearFileInput(fileInput);  
            clearPreview();
            showCallInterface();
        }
    } else if (message) {
        const payload = {
            type: 'chatMessage',
            message: message,
            timestamp: new Date().toISOString(),
            sender: currentUsername,
            senderId: socket.id
        };
        socket.emit('chat:message', { ...payload, room: currentRoomId });
        if (chatDataChannel && chatDataChannel.readyState === 'open') {
            chatDataChannel.send(JSON.stringify(payload));
        }
        chatInput.value = '';
        clearFileInput(fileInput);
    }
});

chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault(); 
        sendChatBtn.click(); 
    }
});

fileIcon.addEventListener('click', () => fileInput.click()); 
fileInput.addEventListener('change', handleFileInputChange); 


// --- takePictureBtn Event Listener (from chat controls) ---
if (takePictureBtn) {
    takePictureBtn.addEventListener('click', () => {
        if (localStream && localStream.getVideoTracks().length > 0) {
            showCameraPovInterface(); 
            cameraPovVideo.srcObject = localStream; 
            cameraPovVideo.muted = true; 
            cameraPovVideo.play().catch(e => console.warn(e));
            applyVideoTransform(cameraPovVideo, currentFacingMode);
        } else {
            alert("Camera stream not available. Please ensure camera is enabled.");
        }
    });
} 


// --- captureShotBtn Event Handlers (for short press photo, long press video) ---
if (captureShotBtn) {
    captureShotBtn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
    });

    const startEvent = 'ontouchstart' in window ? 'touchstart' : 'mousedown';
    const endEvent = 'ontouchend' in window ? 'touchend' : 'mouseup';
    const leaveEvent = 'ontouchcancel' in window ? 'touchcancel' : 'mouseleave';      

    captureShotBtn.addEventListener(startEvent, (e) => {
        if (e.button === 0 || e.type === 'touchstart') {
            clearTimeout(longPressTimer);
            isLongPress = false;
            
            longPressTimer = setTimeout(() => {
                isLongPress = true;
                startRecording();
            }, RECORDING_THRESHOLD_MS);
            
            if (e.type === 'touchstart') {
                e.preventDefault();  
            }
        }
    });

    captureShotBtn.addEventListener(endEvent, (e) => {
        clearTimeout(longPressTimer);

        if (isRecording) {
            stopRecording();
        } else if (!isLongPress) {
            capturePicture(); 
        }
        isLongPress = false; 
        if (e.type === 'touchend') {
            e.preventDefault();
        }
    });

    captureShotBtn.addEventListener(leaveEvent, () => {
        if (!isRecording) { 
            clearTimeout(longPressTimer);
            isLongPress = false;
        }
    });
} 


if (switchCamPovBtn) { 
    switchCamPovBtn.addEventListener('click', switchCamera);
    // Initial disable handled in getLocalStream
} 


// --- FIXED BACK BUTTON LOGIC ---
backToCallBtn.addEventListener('click', () => {
    // 1. If we are recording, stop it first.
    if (isRecording) {
        stopRecording();
        // Discard the recording (or optional: save it?)
        // For "Back", we usually want to cancel.
        recordedChunks = [];
        stopRecordingInternal();
    }
    
    // 2. Clear any preview images/videos
    clearPreview(); 
    
    // 3. Return to call interface
    showCallInterface(); 
    
    // IMPORTANT: Do NOT stop localStream here, because it is shared with the call.
    // Just ensure the main video UI is updated if needed.
});

retakeShotBtn.addEventListener('click', () => {
    clearPreview(); 
    showCameraPovInterface(); 
});

sendShotBtn.addEventListener('click', async () => {
    if (!currentPreviewBlob) {
        alert('No photo or video to send!');
        return;
    }
    sendChatBtn.click();
});


document.addEventListener('DOMContentLoaded', () => {
    if (saveChatHistoryBtn) {
        saveChatHistoryBtn.style.display = 'none'; 
    }
    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
             document.body.classList.toggle('dark-mode');
        });
    }
});