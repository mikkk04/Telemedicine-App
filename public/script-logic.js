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

// Variables for Puppy Icon
let puppyIcon; // Will hold the DOM element for the puppy
const PUPPY_ICON_SIZE = 80; // Must match width/height in CSS

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

// REMOVED: Global array to store chat messages for history
// We no longer store the entire history on the client for server saving.
// The server maintains the authoritative history.


// Function to move the puppy to a random non-overlapping location (MORE ROBUST)
function movePuppy() {
    if (!puppyIcon) { // Ensure puppyIcon is initialized
        puppyIcon = document.getElementById('puppyIcon');
        if (!puppyIcon) return; // If element still not found, exit
    }

    // Safely get dimensions of main UI elements, only if they are visibly active
    const getVisibleRect = (element) => {
        // Check if element exists AND is not explicitly hidden by display: none
        if (element && window.getComputedStyle(element).display !== 'none') {
            return element.getBoundingClientRect();
        }
        // Return an empty/zero rect if element is hidden or doesn't exist
        return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
    };

    // Note: roomSelectionDiv is not on this page anymore. We can ignore it here.
    const callInterfaceRect = getVisibleRect(callInterfaceDiv);
    // Add chatContainer rect if it's considered an obstacle
    const chatContainerRect = getVisibleRect(chatContainer);


    let newX, newY;
    let attempts = 0;
    const maxAttempts = 200; // Increased attempts significantly to find a clear spot

    let foundNonOverlappingPosition = false;

    do {
        newX = Math.random() * (window.innerWidth - PUPPY_ICON_SIZE);
        newY = Math.random() * (window.innerHeight - PUPPY_ICON_SIZE);
        attempts++;

        const tempPuppyRect = {
            left: newX,
            top: newY,
            right: newX + PUPPY_ICON_SIZE,
            bottom: newY + PUPPY_ICON_SIZE
        };

        // Function to check overlap between two rectangles
        const checkOverlap = (rect1, rect2) => {
            // Only check if rect2 has actual dimensions (i.e., is visible and exists)
            if (rect2.width === 0 && rect2.height === 0) return false;

            return tempPuppyRect.left < rect2.right &&
                 tempPuppyRect.right > rect2.left &&
                 tempPuppyRect.top < rect2.bottom &&
                 tempPuppyRect.bottom > rect2.top;
        };

        const overlapsCall = checkOverlap(tempPuppyRect, callInterfaceRect);
        const overlapsChat = checkOverlap(tempPuppyRect, chatContainerRect); // Check overlap with chat

        // A position is valid if it doesn't overlap any *visible* main UI element
        foundNonOverlappingPosition = !(overlapsCall || overlapsChat);

    } while (!foundNonOverlappingPosition && attempts < maxAttempts);

    // Fallback: If after max attempts, a non-overlapping spot wasn't found, place it randomly anyway
    if (!foundNonOverlappingPosition) {
        console.warn("Puppy: Could not find a perfectly non-overlapping spot after many attempts. Placing randomly.");
        // This might still place it on top of a UI element if space is too constrained.
    }

    puppyIcon.style.left = `${newX}px`;
    puppyIcon.style.top = `${newY}px`;
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
        const devices = await navigator.mediaDevices.enumerateDevices();
        availableVideoDevices = devices.filter(d => d.kind === 'videoinput');
        console.log('[Camera_Switch] Found video devices:', availableVideoDevices.map(d => d.label));

        if (switchCamPovBtn) { // Ensure the button exists before manipulating
            if (availableVideoDevices.length <= 1) {
                switchCamPovBtn.disabled = true;
                console.log('[Camera_Switch] Only one or no cameras, disabling switch button.');
            } else {
                switchCamPovBtn.disabled = false;
                console.log('[Camera_Switch] Multiple cameras found, enabling switch button.');
            }
        }

        // Try to get a specific camera based on targetFacingMode or initial preference
        let selectedDevice = null;
        if (availableVideoDevices.length > 0) {
            if (targetFacingMode === 'user') {
                // Try to find a 'user' (front) camera
                selectedDevice = availableVideoDevices.find(d => d.label.toLowerCase().includes('front') || d.facingMode === 'user');
            } else if (targetFacingMode === 'environment') {
                // Try to find an 'environment' (back) camera
                selectedDevice = availableVideoDevices.find(d => d.label.toLowerCase().includes('back') || d.facingMode === 'environment');
            }

            if (!selectedDevice && targetFacingMode !== 'user') { // If target wasn't user and not found, try user
                selectedDevice = availableVideoDevices.find(d => d.label.toLowerCase().includes('front') || d.facingMode === 'user');
            }
            if (!selectedDevice) { // Fallback to environment if user not found, and vice-versa
                selectedDevice = availableVideoDevices.find(d => d.label.toLowerCase().includes('back') || d.facingMode === 'environment');
            }
            if (!selectedDevice) { // Last resort: just pick the first one
                selectedDevice = availableVideoDevices[0];
            }
            
            if (selectedDevice) {
                constraints.video = { deviceId: { exact: selectedDevice.deviceId } }; // Use deviceId for exact selection
                // Add facingMode hint if available, but deviceId is primary
                if (selectedDevice.facingMode) {
                    constraints.video.facingMode = { exact: selectedDevice.facingMode };
                } else if (selectedDevice.label.toLowerCase().includes('front')) {
                    constraints.video.facingMode = 'user';
                } else if (selectedDevice.label.toLowerCase().includes('back')) {
                    constraints.video.facingMode = 'environment';
                }

                currentCameraIndex = availableVideoDevices.findIndex(d => d.deviceId === selectedDevice.deviceId);
                console.log(`[Camera_Switch] Attempting to get specific camera: ${selectedDevice.label || 'Unknown'} (${currentFacingMode})`);
            }
        }
        
        console.log('[LocalStream_Trace] Calling getUserMedia with constraints:', JSON.stringify(constraints));
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        
        console.log('[LocalStream_Trace] getUserMedia successful. Received localStream object:', localStream);
        
        // --- Diagnostic checks for the acquired stream ---
        if (!localStream) {
            console.error('[LocalStream_Trace] localStream is null or undefined after getUserMedia. This should not happen on success.');
            throw new Error("getUserMedia returned null/undefined stream.");
        }
        if (localStream.getVideoTracks().length > 0) {
            const videoTrack = localStream.getVideoTracks()[0];
            const settings = videoTrack.getSettings();
            currentFacingMode = settings.facingMode || 'unknown'; // Update currentFacingMode from actual settings
            console.log(`[LocalStream_Trace] localStream has video track. Facing mode: ${currentFacingMode}, Enabled: ${videoTrack.enabled}, ReadyState: ${videoTrack.readyState}`);
        } else {
            console.warn('[LocalStream_Trace] getUserMedia returned a stream with NO VIDEO TRACKS.');
            throw new Error("getUserMedia succeeded but returned no active video tracks.");
        }
        if (localStream.getAudioTracks().length > 0) {
            const audioTrack = localStream.getAudioTracks()[0];
            console.log(`[LocalStream_Trace] localStream has audio track. Enabled: ${audioTrack.enabled}, ReadyState: ${audioTrack.readyState}`);
        } else {
            console.warn('[LocalStream_Trace] getUserMedia returned a stream with NO AUDIO TRACKS.');
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
        console.error('[LocalStream_Trace] Error getting local stream during getUserMedia (CAUGHT IN FUNCTION):', error);
        let errorMessage = 'Could not get access to camera/microphone.';
        if (error.name === 'NotAllowedError') {
            errorMessage += ' Please grant camera and microphone permissions.';
        } else if (error.name === 'NotFoundError') {
            errorMessage += ' No camera or microphone found.';
        } else if (error.name === 'NotReadableError') {
            errorMessage += ' Camera/microphone is in use by another application.';
        } else if (error.name === 'OverconstrainedError') {
            errorMessage += ' Your device does not support the requested media constraints or specified camera is unavailable.';
            // If Overconstrained, try a generic request without deviceId
            if (constraints.video && constraints.video.deviceId) {
                console.warn('[LocalStream_Trace] OverconstrainedError with specific device, attempting generic video:true.');
                try {
                    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                    const videoTrack = localStream.getVideoTracks()[0];
                    if (videoTrack) {
                        const settings = videoTrack.getSettings();
                        currentFacingMode = settings.facingMode || 'unknown';
                        console.log('[Camera_Switch] Acquired generic stream, detected facingMode:', currentFacingMode);
                        // If generic works, continue normal flow
                        sendChatBtn.disabled = false;
                        chatInput.disabled = false;
                        if (peerConnections.size === 0) {
                            displayLocalStreamInMain();
                        } else {
                            displayLocalStreamInMini();
                        }
                        toggleMicBtn.classList.add('active');
                        toggleCamBtn.classList.add('active');
                        return localStream; // Return successful stream
                    }
                } catch (genericError) {
                    console.error('[LocalStream_Trace] Generic stream attempt also failed:', genericError);
                    errorMessage += ' Tried generic camera access, but that also failed.';
                }
            }
        } else if (error.message && error.message.includes("returned no active tracks")) { // Custom error from diagnostic check
                errorMessage += ' Detected that stream had no active tracks. This might be a device or permission issue.';
        } else {
            errorMessage += ` Detailed error: ${error.message || error.name || 'Unknown error'}`;
        }
        alert(errorMessage);
        window.location.href = '/'; // Redirect to login page on error
        return null;
    } finally {
        isGettingStream = false;
        // setRoomSelectionButtonsState(false); // Re-added comment as this function is now a stub
        console.log('[LocalStream_Trace] Stream acquisition process finished. Final localStream state:', localStream);
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
    if (!newVideoTrack) {
        console.warn('[WebRTC] replaceVideoTrackOnPeers called with no new video track.');
        return;
    }

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
        } else {
            console.log(`[WebRTC] No existing video sender found for peer: ${peerId}. Could not replace track.`);
            // If no sender, it means video wasn't being sent, or renegotiation is needed.
            // For a 1-on-1, if the video track isn't present, it might imply initial setup failed.
        }
    }
}


/**
 * Sets the local stream to the main video element (used when no remote peer is connected).
 */
function displayLocalStreamInMain() {
    console.log('[LocalStream_Trace] displayLocalStreamInMain called (Local is main, no remote peer).');
    
    // Ensure miniVideo is explicitly cleared and hidden
    if (miniVideo.srcObject) {
        miniVideo.srcObject = null;
        console.log('[LocalStream_Trace] Cleared miniVideo srcObject in displayLocalStreamInMain.');
    }
    miniVideoNameLabel.textContent = ''; // Clear mini video label
    hideMiniVideo(); // from script-base.js

    // Set localStream to mainVideo
    mainVideo.srcObject = localStream;
    console.log('[LocalStream_Trace] mainVideo.srcObject set to localStream in displayLocalStreamInMain. Current mainVideo.srcObject:', mainVideo.srcObject);
    // Apply transform based on the current camera's facing mode
    applyVideoTransform(mainVideo, currentFacingMode);  
    mainVideo.muted = true; // Mute local video in main (self-view)
    mainVideoNameLabel.textContent = currentUsername || 'You';
    // mainVideo.load(); // Removed this line - browser handles load when srcObject is set
    mainVideo.play().catch(e => console.warn('[MainVideo_Trace] Local mainVideo play error in displayLocalStreamInMain:', e)); // Ensure local plays in main

    // Clear remoteStream data and reset main video label if it was showing remote (unlikely, but for robustness)
    remoteStream = new MediaStream(); // Reset remoteStream completely
    mainVideoNameLabel.textContent = currentUsername || 'You'; // Ensure label is local's

    console.log('Local video set to main frame. Mini hidden.');
}

/**
 * Sets the local stream to the mini video element and attempts to set remote stream to main video.
 * (Used when a remote peer is connected or expected).
 */
function displayLocalStreamInMini() {
    console.log('[LocalStream_Trace] displayLocalStreamInMini called (Local is mini, Remote is main).');

    // Clear mainVideo srcObject if it's currently showing local and it's not the remote stream
    if (mainVideo.srcObject === localStream) { // Only clear if it was showing local
        mainVideo.srcObject = null;
        console.log('[LocalStream_Trace] Cleared mainVideo srcObject (was showing local) in displayLocalStreamInMini.');
    }
    // Set a temporary label for main video until remote peer name is confirmed
    mainVideoNameLabel.textContent = 'Connecting...'; // Set generic connecting label


    // Set localStream to miniVideo
    if (miniVideo.srcObject !== localStream) { // Avoid unnecessary re-assignment
        miniVideo.srcObject = localStream;
        console.log('[LocalStream_Trace] miniVideo.srcObject assigned to localStream in displayLocalStreamInMini. Current miniVideo.srcObject:', miniVideo.srcObject);
        // Apply transform based on the current camera's facing mode
        applyVideoTransform(miniVideo, currentFacingMode);    
        miniVideo.muted = true; // Mute local video in mini
        miniVideoNameLabel.textContent = currentUsername || 'You';
        // miniVideo.load(); // Removed this line - browser handles load when srcObject is set
        miniVideo.play().catch(e => console.warn('[MiniVideo_Trace] miniVideo play error in displayLocalStreamInMini:', e)); // Ensure local plays in mini
    }
    showMiniVideo(); // from script-base.js


    // Set remoteStream to mainVideo if available
    if (remoteStream && remoteStream.getTracks().length > 0) {
        if (mainVideo.srcObject !== remoteStream) { // Avoid unnecessary re-assignment
            mainVideo.srcObject = remoteStream;
            mainVideo.style.transform = 'none'; // Remote video is not flipped
            mainVideo.muted = false; // Unmute remote video in main
            console.log('[LocalStream_Trace] mainVideo.srcObject set to remoteStream in displayLocalStreamInMini. Current mainVideo.srcObject:', mainVideo.srcObject);
            // mainVideo.load(); // Removed this line - browser handles load when srcObject is set
            mainVideo.play().catch(e => { // Aggressive play
                if (e.name === 'AbortError') {
                    console.warn('[MainVideo_Trace] Remote mainVideo play AbortError (often expected):', e.message);
                } else {
                    console.error('[MainVideo_Trace] Remote mainVideo play error:', e);
                }
            });
        }
        // Update mainVideoNameLabel with remote peer's name
        const remotePeerId = Array.from(peerConnections.keys())[0]; // Assuming 1-on-1 for this logic
        if (remotePeerId) {
            const remoteUsername = remoteUsernames.get(remotePeerId);
            if (remoteUsername) {
                mainVideoNameLabel.textContent = remoteUsername;
                updatePeerStatus(true, remoteUsername);
            } else {
                socket.emit('get:peer:username', { peerId: remotePeerId });
                mainVideoNameLabel.textContent = `Connecting... (${remotePeerId.substring(0, 6)})`;
            }
        } else {
            mainVideoNameLabel.textContent = 'Remote Peer';
        }
    } else {
        // If no remote stream yet, ensure mainVideo is black/connecting state
        if (mainVideo.srcObject !== null) {
            mainVideo.srcObject = null;
            console.log('[LocalStream_Trace] mainVideo.srcObject set to null/connecting state in displayLocalStreamInMini.');
        }
        mainVideoNameLabel.textContent = 'Connecting...'; // Keep connecting label if no remote stream
    }
    console.log('Local video set to mini frame. Main cleared/set for remote.');
}


function createPeerConnection(peerId, isInitiator = false) {
    console.log(`[WebRTC] Creating RTCPeerConnection for peerId: ${peerId}, Initiator: ${isInitiator}`);
    const peerConnection = new RTCPeerConnection(peerConfig);

    peerConnections.set(peerId, peerConnection);

    if (localStream) {
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
            console.log(`[WebRTC] Adding local track to PC: ${track.kind}, id: ${track.id}`);
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
            console.log('[WebRTC] ICE candidate sent.');
        }
    };

    peerConnection.ontrack = (event) => {
        console.log(`[WebRTC] Remote track received: kind=${event.track.kind}, id=${event.track.id}, enabled=${event.track.enabled}, readyState=${event.track.readyState}`);
        console.log(`[WebRTC] Remote track receiver:`, event.receiver); // Log the receiver details

        if (!remoteStream.getTrackById(event.track.id)) {
            remoteStream.addTrack(event.track);
            console.log(`[WebRTC] Remote track added to remoteStream: ${event.track.kind}, id: ${event.track.id}`);
            
            // NEW LOGS for specific track types after adding to remoteStream
            if (event.track.kind === 'video') {
                const videoTrack = remoteStream.getVideoTracks()[0]; // Assuming only one video track for 1-on-1
                if (videoTrack) {
                    console.log(`[WebRTC - Video] remoteStream video track state: enabled=${videoTrack.enabled}, readyState=${videoTrack.readyState}, muted=${videoTrack.muted}`);
                    // Optional: Listen for video track state changes
                    videoTrack.onended = () => console.log('[WebRTC - Video] Remote video track ENDED!');
                    videoTrack.onmute = () => console.log('[WebRTC - Video] Remote video track MUTED!');
                    videoTrack.onunmute = () => console.log('[WebRTC - Video] Remote video track UNMUTED!');
                }
            } else if (event.track.kind === 'audio') {
                const audioTrack = remoteStream.getAudioTracks()[0]; // Assuming only one audio track for 1-on-1
                if (audioTrack) {
                    console.log(`[WebRTC - Audio] remoteStream audio track state: enabled=${audioTrack.enabled}, readyState=${audioTrack.readyState}, muted=${audioTrack.muted}`);
                    audioTrack.onended = () => console.log('[WebRTC - Audio] Remote audio track ENDED!');
                    audioTrack.onmute = () => console.log('[WebRTC - Audio] Remote audio track MUTED!');
                    audioTrack.onunmute = () => console.log('[WebRTC - Audio] Remote audio track UNMUTED!');
                }
            }
        } else {
            console.log(`[WebRTC] Remote track already in remoteStream: ${event.track.kind}, id: ${event.track.id}`);
        }

        console.log(`[WebRTC] Current remoteStream tracks count: ${remoteStream.getTracks().length}`);
        // The display update logic is now handled more robustly within this function.
        if (peerConnections.size > 0 && localStream && remoteStream && remoteStream.getTracks().length > 0) {
            displayLocalStreamInMini();
        } else {
            displayLocalStreamInMain();
        }

        // Use the actual username from the mapping, or fallback to a default if not yet known
        const remotePeerId = Array.from(peerConnections.keys())[0];
        const remoteUsername = remoteUsernames.get(remotePeerId) || `Peer (${remotePeerId.substring(0, 6)})`;
        mainVideoNameLabel.textContent = remoteUsername; // Update label when track received
        updatePeerStatus(true, remoteUsername); // updatePeerStatus is in script-base.js
    };


    peerConnection.oniceconnectionstatechange = () => {
        console.log(`[WebRTC] ICE connection state changed: ${peerConnection.iceConnectionState}`);
        if (peerConnection.iceConnectionState === 'failed' || peerConnection.iceConnectionState === 'disconnected') {
            const disconnectedUsername = remoteUsernames.get(peerId) || `Peer (${peerId.substring(0, 6)})`;
            mainVideoNameLabel.textContent = `${disconnectedUsername} (Disconnected)`;
            if (peerConnections.size === 1) updatePeerStatus(false); // updatePeerStatus is in script-base.js
        } else if (peerConnection.iceConnectionState === 'connected') {
            // Only update label if mainVideo is displaying this remote stream
            if (mainVideo.srcObject === remoteStream) {  
                mainVideoNameLabel.textContent = remoteUsernames.get(peerId) || 'Remote Peer';
            }
        }
    };

    peerConnection.onconnectionstatechange = () => {
        console.log(`[WebRTC] Peer connection state changed: ${peerConnection.connectionState}`);
        if (peerConnection.connectionState === 'disconnected' || peerConnection.connectionState === 'failed') {
            if (peerConnections.size === 1) {
                updatePeerStatus(false); // updatePeerStatus is in script-base.js
            }
            // If the main video was showing this peer, update its name to disconnected
            if (mainVideo.srcObject === remoteStream) {
                const disconnectedUsername = remoteUsernames.get(peerId) || `Peer (${peerId.substring(0, 6)})`;
                mainVideoNameLabel.textContent = `${disconnectedUsername} (Disconnected)`;
            }
        } else if (peerConnection.connectionState === 'connected') {
                     // Re-update name to actual username if it changed during connection phases
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
    console.log(`[WebRTC] Received offer from ${senderUsername} (${senderId})`);
    // Store the username immediately when offer is received
    remoteUsernames.set(senderId, senderUsername);

    const peerConnection = createPeerConnection(senderId, false);

    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    socket.emit('webrtc:answer', {
        answer: answer,
        targetSocketId: senderId,
        room: currentRoomId,
        username: currentUsername // Include your username in the answer
    });
    console.log('[WebRTC] Answer sent.');

    // If this is the only remote peer, display their name on main video
    if (peerConnections.size === 1 && remoteStream && remoteStream.getTracks().length > 0) {
        mainVideoNameLabel.textContent = senderUsername;
        updatePeerStatus(true, senderUsername); // updatePeerStatus is in script-base.js
    }
}

async function handleAnswer(answer, senderId, senderUsername) {
    console.log(`[WebRTC] Received answer from ${senderId} (${senderUsername})`); // Fixed log to show senderUsername
    // Store the username immediately when answer is received
    remoteUsernames.set(senderId, senderUsername);

    const peerConnection = peerConnections.get(senderId);
    if (peerConnection) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        // If this is the main peer, update the main video label
        if (mainVideo.srcObject === remoteStream) {
            mainVideoNameLabel.textContent = senderUsername;
            updatePeerStatus(true, senderUsername); // updatePeerStatus is in script-base.js
        }
    }
}

function handleCandidate(candidate, senderId) {
    console.log(`[WebRTC] Received ICE candidate from ${senderId}`);
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
                // IMPORTANT: No longer re-emitting DataChannel messages to the server.
                // The server receives messages from the original sender.
                // IMPORTANT: No longer directly calling displayMessage from here.
                // All chat message displays are now centralized via socket.on('chat:message').

                if (payload.senderId !== socket.id) {
                    console.log('[Chat] Remote message received directly via DataChannel. It will be displayed when echoed from server.');
                } else {
                    console.log('[Chat] Own message echoed via DataChannel (from peer). It will be displayed when echoed from server.');
                }
                
                handleTypingIndicatorForDataChannel(false); // Ensure typing indicator clears on message
            } else if (payload.type === 'typing') {
                handleTypingIndicatorForDataChannel(payload.isTyping, payload.sender);
            }
        } catch (e) {
            console.error('Failed to parse Data Channel message:', e);
        }
    };
    channel.onclose = () => console.log('[DataChannel] Closed!');
    channel.onerror = (error) => console.error('[DataChannel] Error:', error);
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
        console.error('[Socket.IO Server Error]', errorMessage);
        alert(`An error occurred: ${errorMessage}`);
        window.location.href = '/';
    });
    
    socket.on('auth:failed', (message) => {
        console.error('[Socket.IO Authentication Failed]', message);
        alert(`Authentication Failed: ${message}`);
        window.location.href = '/';
    });

    socket.on('connect_error', (error) => {
        console.error('[Socket.IO Error] Connection failed:', error);
        alert('Failed to connect to the signaling server. Please try again.');
        window.location.href = '/';
    });
    
    socket.on('room:created', (data) => {
        if (data.user) {
            currentUsername = data.user.username;
            currentUserRole = data.user.role;
            console.log(`[Auth] Joined as creator. Authoritative user: '${currentUsername}', Role: '${currentUserRole}'`);
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
    
    // --- MODIFICATION START: New logic for room:joined to initiate WebRTC connection ---
    socket.on('room:joined', async (data) => {
        if (data.user) {
            currentUsername = data.user.username;
            currentUserRole = data.user.role;
            console.log(`[Auth] Joined existing room. Authoritative user: '${currentUsername}', Role: '${currentUserRole}'`);
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
            // Patient needs to initiate the call to the existing doctor
            data.usersInRoom.forEach(user => {
                if (user.username !== currentUsername) {
                    remoteUsernames.set(user.id, user.username);
                    handleExistingPeer(user.id, user.username); // Initiate connection to existing peer
                }
            });
        }
        
        if (data.chatHistory && Array.isArray(data.chatHistory)) {
            console.log('[ChatHistory] Loading existing chat history from server.');
            data.chatHistory.forEach(msg => {
                displayMessage(msg.username, msg.message, msg.username === currentUsername, msg.fileUrl, msg.timestamp);
            });
            chatBox.scrollTop = chatBox.scrollHeight;
        }
    });
    // --- END MODIFICATION ---

    socket.on('room:not-found', () => {
        alert('The requested room does not exist. It may have been closed.');
        window.location.href = '/';
    });

    socket.on('room:full', () => {
        alert('The room you tried to join is full.');
        window.location.href = '/';
    });

    socket.on('user:joined', (data) => {
        console.log(`[Event] 'user:joined' received. Peer Name: ${data.username}. My Name: ${currentUsername}.`);

        if (data.id !== socket.id && !peerConnections.has(data.id)) {
            
            const peerUsername = data.username;
            remoteUsernames.set(data.id, peerUsername);
            
            updatePeerStatus(true, peerUsername);
            displayMessage('System', `${peerUsername} has joined.`, false, null, new Date().toISOString());

            console.log(`[WebRTC] Existing client (${currentUsername}) initiating offer to new user: ${peerUsername} (${data.id})`);
            handleNewPeer(data.id, peerUsername);
            displayLocalStreamInMini();

        } else {
            console.log(`[Event] 'user:joined' event ignored for id: ${data.id} (already connected or self).`);
        }
    });

    // --- MODIFICATION START: Updated 'user:left' handler to be centralized and a new 'call:end' handler ---
    socket.on('user:left', (data) => {
        console.log(`User ${data.username} (${data.id}) left the call.`);
        displayMessage('System', `${data.username} has left the call.`, false, null, new Date().toISOString());
        // Clean up WebRTC connection
        if (peerConnections.has(data.id)) {
            peerConnections.get(data.id).close();
            peerConnections.delete(data.id);
            remoteUsernames.delete(data.id);
        }
        // Update UI to reflect disconnection
        stopMediaStream(remoteStream);
        remoteStream = new MediaStream();
        displayLocalStreamInMain();
        mainVideoNameLabel.textContent = `${currentUsername} - You`;
        updatePeerStatus(false);
    });

    socket.on('call:end', (data) => {
        console.log('[UI] Received call:end event. Initiating UI cleanup and redirection.');
        // Show notification and redirect on OK
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
        resetCallUI(); // Clean up all streams and peer connections
    });
    // --- END MODIFICATION ---

    socket.on('webrtc:offer', (data) => handleOffer(data.offer, data.senderSocketId, data.senderUsername));
    socket.on('webrtc:answer', (data) => handleAnswer(data.answer, data.senderSocketId, data.senderUsername));
    socket.on('webrtc:ice-candidate', (data) => handleCandidate(data.candidate, data.senderSocketId));
    
    socket.on('chat:message', (data) => {
        // We now centralize all message display here, regardless of origin (own or remote)
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

    // --- FIX START: Improved disconnect handler to avoid unwanted alerts on intentional disconnect ---
    socket.on('disconnect', (reason) => {
        console.log(`[Socket.IO] Disconnected. Reason: ${reason}`);
        // Check for intentional disconnect reasons
        const isIntentional = (reason === 'io client disconnect' || reason === 'transport close');
    
        // A flag to prevent double-handling if a call:end event was just processed
        const isRedirecting = (
            window.location.pathname.includes('/patient-dashboard.html') ||
            window.location.pathname.includes('/doctor-dashboard.html') ||
            window.location.pathname === '/'
        );
    
        // Only show a notification for UNINTENTIONAL disconnections
        if (!isIntentional && !isRedirecting) {
            console.log('[Socket.IO] UNEXPECTED disconnection. Showing alert and redirecting.');
            showCallEndNotification(
                'Connection lost unexpectedly. Please check your network and try again.',
                () => {
                    window.location.href = '/'; // Generic redirect on unexpected error
                }
            );
            resetCallUI();
        } else {
            console.log('[Socket.IO] Disconnection was intentional or benign. No alert needed.');
        }
    });
    // --- FIX END ---

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
    
    // --- MODIFICATION START: New function for handling existing peer (patient joins doctor) ---
    async function handleExistingPeer(peerId, peerUsername) {
        console.log(`[WebRTC] New client (${currentUsername}) initiating call to existing user: ${peerUsername} (${peerId})`);
        
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
    // --- END MODIFICATION ---
} // End of setupSocketEventListeners function

/**
 * Stops all tracks in a given media stream.
* @param {MediaStream} stream The stream whose tracks should be stopped.
 */
function stopMediaStream(stream) {
    if (stream) {
        stream.getTracks().forEach(track => {
            track.stop();
            console.log(`[Media] Stopped track: ${track.kind} (${track.id})`);
        });
    }
}

/**
 * REFACTORED: Switches the local camera and correctly updates all relevant video elements.
 */
async function switchCamera() {
    console.log('[Camera_Switch] switchCamera called.');
    if (!localStream || availableVideoDevices.length <= 1) {
        console.warn('[Camera_Switch] Cannot switch camera: No local stream or only one camera available.');
        alert('Cannot switch camera. Please ensure camera is active and more than one camera is available.');
        return;
    }

    // Stop current local stream tracks to release the camera
    console.log('[Camera_Switch] Stopping current local stream tracks.');
    stopMediaStream(localStream);

    // Determine the next camera to use
    currentCameraIndex = (currentCameraIndex + 1) % availableVideoDevices.length;
    const nextDevice = availableVideoDevices[currentCameraIndex];

    const newConstraints = {
        video: {
            deviceId: { exact: nextDevice.deviceId },
            facingMode: nextDevice.facingMode ? { exact: nextDevice.facingMode } : undefined
        },
        audio: true
    };
    console.log('[Camera_Switch] Attempting to switch to camera:', nextDevice.label || nextDevice.deviceId, 'with constraints:', JSON.stringify(newConstraints.video));

    try {
        const newStream = await navigator.mediaDevices.getUserMedia(newConstraints);
        localStream = newStream; // Update global localStream reference
        console.log('[Camera_Switch] New stream acquired after switch:', newStream);

        const newVideoTrack = newStream.getVideoTracks()[0];
        if (newVideoTrack) {
            const settings = newVideoTrack.getSettings();
            currentFacingMode = settings.facingMode || 'unknown';
            console.log('[Camera_Switch] New camera acquired. Detected facingMode:', currentFacingMode);
        } else {
            currentFacingMode = 'unknown';
            console.warn('[Camera_Switch] No video track in new stream, cannot determine facingMode.');
        }

        // --- SIMPLIFIED AND CORRECTED UPDATE LOGIC ---
        // Update all elements that are meant to display the local stream.
        
        // 1. The Camera POV video element
        cameraPovVideo.srcObject = localStream;
        
        // 2. The mini video element (primary holder for local stream during a call)
        miniVideo.srcObject = localStream;

        // 3. The main video element, ONLY if it's supposed to be showing the local stream (i.e., no peers)
        if (peerConnections.size === 0) {
            mainVideo.srcObject = localStream;
        }

        // Play all updated elements to ensure they're live and not frozen
        cameraPovVideo.play().catch(e => console.warn('[Camera_Switch] cameraPovVideo play error:', e));
        miniVideo.play().catch(e => console.warn('[Camera_Switch] miniVideo play error:', e));
        if (peerConnections.size === 0) {
              mainVideo.play().catch(e => console.warn('[Camera_Switch] mainVideo play error:', e));
        }

        // Apply correct mirroring transform to all local video displays
        applyVideoTransform(cameraPovVideo, currentFacingMode);
        applyVideoTransform(miniVideo, currentFacingMode);
        if (peerConnections.size === 0) {
            applyVideoTransform(mainVideo, currentFacingMode);
        }

        // Finally, send the new video track to all connected peers.
        await replaceVideoTrackOnPeers(newVideoTrack);
        console.log('[Camera_Switch] Camera switch complete and tracks replaced on peers.');

    } catch (error) {
        console.error('[Camera_Switch] Error switching camera:', error);
        alert(`Failed to switch camera: ${error.name}. Please ensure another camera is available and accessible.`);
        // Attempt to re-acquire a default stream if the switch fails, to restore video.
        await getLocalStream();
    }
}

/**
 * Clears the shot preview interface and revokes any active object URLs.
 */
function clearPreview() {
    console.log('[Preview] Clearing preview...');
    if (currentPreviewUrl) {
        URL.revokeObjectURL(currentPreviewUrl);
        currentPreviewUrl = null;
        console.log('[Preview] Revoked previous object URL.');
    }
    capturedShotImage.style.display = 'none';
    capturedShotImage.src = '';
    capturedVideoPreview.style.display = 'none';
    capturedVideoPreview.src = '';
    // capturedVideoPreview.load(); // Removed this line
    capturedVideoPreview.pause(); // Pause video preview
    currentPreviewBlob = null;
    currentPreviewType = 'none';
    console.log('[Preview] Preview cleared.');
}

// --- FIX START: New helper function to avoid CSP issues ---
/**
 * Converts a data URL string to a Blob object.
 * This avoids using fetch(), which can be blocked by Content-Security-Policy.
 * @param {string} dataurl The data URL to convert.
 * @returns {Blob|null} The resulting Blob object, or null on failure.
 */
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
// --- FIX END ---

/**
 * Handles taking a single picture from the cameraPovVideo.
 */
function capturePicture() {
    console.log('[Camera] Short press detected: Capturing picture.');
    if (!cameraPovVideo || !cameraPovVideo.srcObject) { // Ensure video element and stream exist
        console.warn('[Camera] Camera stream not available for picture capture. cameraPovVideo:', cameraPovVideo);
        alert("Camera stream not available. Cannot capture picture.");
        return;
    }

    const { videoWidth, videoHeight } = cameraPovVideo;
    hiddenPhotoCanvas.width = videoWidth;
    hiddenPhotoCanvas.height = videoHeight;
    const context = hiddenPhotoCanvas.getContext('2d');
    if (context) {
        // Draw video frame onto canvas. IMPORTANT: Apply the same transform as the video is showing.
        const transform = cameraPovVideo.style.transform;
        if (transform === 'scaleX(-1)') {
            context.translate(videoWidth, 0);
            context.scale(-1, 1);
        }
        context.drawImage(cameraPovVideo, 0, 0, videoWidth, videoHeight);
        
        // Reset canvas transform state if it was mirrored, so subsequent drawings aren't affected
        if (transform === 'scaleX(-1)') {
            context.setTransform(1, 0, 0, 1, 0, 0); // Reset to default
        }

        const imageDataUrl = hiddenPhotoCanvas.toDataURL('image/png');
        
        // --- FIX START: Use helper function instead of fetch() to avoid CSP error ---
        const blob = dataURLtoBlob(imageDataUrl);

        if (blob) {
            currentPreviewBlob = blob; // Store the Blob
            // For image preview, we can still use the efficient data URL directly.
            currentPreviewUrl = imageDataUrl;
            capturedShotImage.src = currentPreviewUrl;
            capturedShotImage.style.display = 'block';
            capturedVideoPreview.style.display = 'none';
            capturedVideoPreview.pause();
            currentPreviewType = 'image';
            showShotPreviewInterface();
            console.log('[Camera] Picture captured and displayed for preview.');
        } else {
            console.error('[Camera] Error converting image to blob using helper function.');
            alert('Failed to process image for preview/send.');
        }
        // --- FIX END ---

    } else {
        console.error('[Camera] Canvas context not available.');
    }
}

/**
 * Starts video recording from the cameraPovVideo stream.
 */
function startRecording() {
    console.log('[Camera] Attempting to start recording...');
    if (!localStream || !localStream.active) {
        console.warn('[Camera] No active video stream available for recording.');
        alert('No camera stream available to record.');
        return;
    }
    if (isRecording) {
        console.warn('[Camera] Recording already active.');
        return;
    }

    // --- FIX: Construct a new, clean media stream for the recorder ---
    // This prevents errors if the original stream is missing an audio track or is in a bad state.
    const videoTracks = localStream.getVideoTracks();
    const audioTracks = localStream.getAudioTracks();

    if (videoTracks.length === 0) {
        console.error('[Camera] Recording failed: No video track found in localStream.');
        alert('Cannot record: Video track is missing.');
        return;
    }

    const streamForRecorder = new MediaStream([...videoTracks, ...audioTracks]);
    // --- End of Fix ---

    // Indicate recording is starting
    isRecording = true;
    if (recordingIndicator) recordingIndicator.style.display = 'inline-block';
    console.log('[Camera] Starting video recording...');
    if (captureShotBtn) captureShotBtn.querySelector('i').className = 'fas fa-stop-circle'; // Change button icon to stop

    recordedChunks = [];
    try {
        // Prefer 'video/webm; codecs=vp8' for broader compatibility if available
        let options = { mimeType: 'video/webm' };
        if (MediaRecorder.isTypeSupported('video/webm; codecs=vp8')) {
            options = { mimeType: 'video/webm; codecs=vp8' };
        } else if (MediaRecorder.isTypeSupported('video/webm')) {
            options = { mimeType: 'video/webm' };
        } else if (MediaRecorder.isTypeSupported('video/mp4')) { // Fallback to MP4 if WebM not supported
            options = { mimeType: 'video/mp4' };
        } else {
            console.warn('[Camera] No supported video recording mimeType found. Trying default.');
        }
        console.log('[Camera] MediaRecorder options:', options);
        // Use the new, clean stream for the recorder
        mediaRecorder = new MediaRecorder(streamForRecorder, options);

        mediaRecorder.ondataavailable = (event) => {
            console.log('[Camera] ondataavailable event. Data size:', event.data.size, 'Time:', new Date().toLocaleTimeString());
            if (event.data.size > 0) {
                recordedChunks.push(event.data);
            }
        };

        mediaRecorder.onstop = handleRecordingStop;
        mediaRecorder.onerror = (event) => {
            console.error('[Camera] MediaRecorder error:', event.error);
            alert(`Video recording error: ${event.error.name}.`);
            isRecording = false;
            if (recordingIndicator) recordingIndicator.style.display = 'none';
            if (captureShotBtn) captureShotBtn.querySelector('i').className = 'fas fa-camera'; // Revert button icon
        };

        mediaRecorder.start();
        console.log(`[Camera] MediaRecorder started with mimeType: ${options.mimeType}. State: ${mediaRecorder.state}`);
    } catch (e) {
        console.error('[Camera] Failed to create MediaRecorder:', e);
        alert('Failed to start video recording. Check camera/mic permissions and browser support.');
        isRecording = false;
        if (recordingIndicator) recordingIndicator.style.display = 'none';
        if (captureShotBtn) captureShotBtn.querySelector('i').className = 'fas fa-camera'; // Revert button icon
    }
}

/**
 * Stops video recording and processes the recorded chunks.
 */
function stopRecording() {
    console.log('[Camera] Attempting to stop recording...');
    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
        console.warn('[Camera] MediaRecorder not active, cannot stop.');
        return;
    }
    if (isRecording) { // Only stop if it was actually in recording state
        console.log('[Camera] Stop signal received: Stopping video recording.');
        mediaRecorder.stop(); // This triggers mediaRecorder.onstop
        isRecording = false;
        if (recordingIndicator) recordingIndicator.style.display = 'none';
        if (captureShotBtn) captureShotBtn.querySelector('i').className = 'fas fa-camera'; // Revert button icon
    }
}

/**
 * Handles the completion of video recording, creating a Blob and displaying it.
 */
function handleRecordingStop() {
    console.log('[Camera] MediaRecorder stopped. Processing recorded chunks...');
    if (recordedChunks.length === 0) {
        console.warn('[Camera] No video data recorded (recordedChunks is empty).');
        alert('No video recorded. Please ensure camera is active and try again.');
        return;
    }

    const mimeType = mediaRecorder.mimeType;
    currentPreviewBlob = new Blob(recordedChunks, { type: mimeType });
    recordedChunks = []; // Clear chunks for next recording

    if (currentPreviewBlob.size === 0) {
        console.warn('[Camera] Recorded video blob is empty (size 0).');
        alert('Recorded video is empty. Please try recording again.');
        return;
    }

    currentPreviewUrl = URL.createObjectURL(currentPreviewBlob); // Create URL for preview
    currentPreviewType = 'video';

    // Show the video preview, hide the image preview
    capturedShotImage.style.display = 'none';
    capturedShotImage.src = '';
    capturedVideoPreview.src = currentPreviewUrl;
    capturedVideoPreview.style.display = 'block';
    capturedVideoPreview.controls = true; // Show video controls for playback
    capturedVideoPreview.loop = true; // Loop video in preview
    capturedVideoPreview.play().catch(e => console.warn('[Preview] Video preview play error:', e));

    showShotPreviewInterface(); // Show the preview interface
    console.log('[Camera] Video recorded and displayed for preview. URL:', currentPreviewUrl, 'Blob size:', currentPreviewBlob.size, 'MimeType:', currentPreviewBlob.type);
}


// --- Event Listeners for UI Actions ---
// NOTE: Create Meeting and Join Meeting button listeners have been REMOVED.
// The `connect` event listener in setupSocketEventListeners now handles the auto-start logic.

// Toggle Microphone button
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

// Toggle Camera button
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

// --- FIX START: Corrected End Call button logic ---
// End Call button
endCallBtn.addEventListener('click', () => {
    console.log('[UI] End Call button clicked. Disconnecting socket and redirecting local user.');
    // Emit the event to inform the other peer before disconnecting.
    socket.emit('call:end');

    // Manually run the redirection logic for the local user immediately.
    // The `call:end` handler is what redirects the other peer. We cannot rely on it here
    // because we are about to disconnect.
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
    resetCallUI(); // Clean up all local streams and peer connections first
    socket.disconnect(); // Finally, disconnect the socket. This will trigger the remote user's redirection logic.
});
// --- FIX END ---

/**
 * Resets the UI and internal state of the call interface.
 * Stops local media tracks, closes peer connections, clears variables.
 */
function resetCallUI() {
    console.log('[LocalStream_Trace] resetCallUI called. Stopping local stream and closing peer connections.');
    stopMediaStream(localStream); // Use helper to stop tracks
    localStream = null;
    
    peerConnections.forEach(pc => pc.close());
    peerConnections.clear();
    remoteUsernames.clear(); // Clear the username mapping on reset
    remoteStream = new MediaStream(); // Reset remote stream
    if (mainVideo) mainVideo.srcObject = null; // Explicitly clear main video source
    if (miniVideo) miniVideo.srcObject = null; // Explicitly clear mini video source
    currentRoomId = null; // Clear room ID
    currentUsername = null; // Clear username
    currentUserRole = null; // Clear role
    if (chatBox) chatBox.innerHTML = ''; // Clear chat UI

    stopCallTimer(); // stopCallTimer is in script-base.js
    updatePeerStatus(false);    
    // showRoomSelection(); // Removed
    hideMiniVideo(); // hideMiniVideo is in script-base.js
    // movePuppy(); // Removed

    // Reset camera state variables
    availableVideoDevices = [];
    currentCameraIndex = 0;
    currentFacingMode = 'user'; // Reset to default preference
    if (switchCamPovBtn) switchCamPovBtn.disabled = true; // Disable button on reset

    // Clear any active recording or preview state
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
    recordedChunks = [];
    isRecording = false;
    isLongPress = false;
    clearTimeout(longPressTimer);
    clearPreview(); // Clear any existing photo/video preview
    if (recordingIndicator) recordingIndicator.style.display = 'none'; // Hide indicator
    if (captureShotBtn) captureShotBtn.querySelector('i').className = 'fas fa-camera'; // Revert button icon
}


// Event listener for double-click on main video (for desktop)
mainVideoContainer.addEventListener('dblclick', () => {
    // This handles double-clicks on DESKTOP devices
    console.log('[UI] mainVideoContainer double-clicked (desktop). Attempting to switch camera.');
    switchCamera();

    if (peerConnections.size > 0 && miniVideoContainer.classList.contains('mini-preview-hidden')) {
        showMiniVideo();
    }
});

// CORRECTED: Add a 'touchend' listener for a more responsive double-tap on MOBILE devices
let lastTap = 0;
mainVideoContainer.addEventListener('touchend', (e) => {
    const currentTime = new Date().getTime();
    const tapLength = currentTime - lastTap;
    if (tapLength < 300 && tapLength > 0) {
        // Double-tap detected
        e.preventDefault(); // Prevent the browser from also firing a 'dblclick' event
        console.log('[UI] mainVideoContainer double-tapped (mobile). Attempting to switch camera.');
        
        switchCamera(); // Switch the camera

        // Also, show the mini video if it's hidden
        if (peerConnections.size > 0 && miniVideoContainer.classList.contains('mini-preview-hidden')) {
            showMiniVideo();
        }
        lastTap = 0; // Reset lastTap to prevent a third tap from also triggering a double-tap
    } else {
        lastTap = currentTime;
    }
});


// Toggle Chat button
toggleChatBtn.addEventListener('click', () => chatContainer.classList.toggle('chat-open'));
// Exit Chat button
exitChatBtn.addEventListener('click', () => chatContainer.classList.remove('chat-open'));

/**
 * Emits typing status to the remote peer via DataChannel or Socket.IO.
 * @param {boolean} isTyping - True if currently typing, false otherwise.
 */
function emitTypingStatus(isTyping) {
    const payload = { type: 'typing', isTyping, sender: currentUsername, senderId: socket.id };
    if (chatDataChannel && chatDataChannel.readyState === 'open') {
        chatDataChannel.send(JSON.stringify(payload));
    } else if (socket.connected && currentRoomId) {
        // Fallback to Socket.IO for typing status if DataChannel isn't available
        socket.emit('chat:typing', { ...payload, room: currentRoomId });
    }
}

// Event listener for chat input to manage typing indicator
if (chatInput) {
    chatInput.addEventListener('input', () => {
        // Only send typing status if there's text
        if (chatInput.value.trim().length > 0) {
            if (!typingTimeout) emitTypingStatus(true); // Send 'typing' event immediately
            clearTimeout(typingTimeout);
            typingTimeout = setTimeout(() => {
                emitTypingStatus(false); // Send 'stopped typing' after delay
                typingTimeout = null;
            }, TYPING_TIMEOUT_DELAY);
        } else {
            // If input is empty, immediately send 'not typing'
            clearTimeout(typingTimeout);
            emitTypingStatus(false);
            typingTimeout = null;
        }
    });
}

// Helper function to safely clear file input value without triggering change event
function clearFileInput(inputElement) {
    if (inputElement) {
        console.log('[FileUpload_DEBUG] clearFileInput called. Removing listener.');
        inputElement.removeEventListener('change', handleFileInputChange);
        
        try {
            // Attempt to clear files property directly for some browsers (e.g., Firefox)
            // Note: This might not be permitted by all browsers for security reasons.
            inputElement.files = null;  
            console.log('[FileUpload_DEBUG] fileInput.files attempted to be set to null.');
        } catch (e) {
            console.warn('[FileUpload_DEBUG] Error setting fileInput.files to null (often expected due to security):', e);
        }
        
        inputElement.value = ''; // This is the standard way
        console.log('[FileUpload_DEBUG] fileInput.value set to empty string.');

        // Re-add the event listener after a tiny delay
        setTimeout(() => {
            inputElement.addEventListener('change', handleFileInputChange);
            console.log('[FileUpload_DEBUG] Listener re-added after delay.');
        }, 0);
    }
}

// Named function for fileInput.addEventListener('change') to allow removing/re-adding it
function handleFileInputChange(event) {
    console.log('[FileUpload_DEBUG] handleFileInputChange triggered!'); // Add this line
    const file = event.target.files[0];
    if (file) {
        console.log(`[FileUpload_DEBUG] File selected: ${file.name}`);
        selectedFileForUpload = file;
        chatInput.value = `File: ${file.name}`; // Show selected file name in chat input
        chatInput.focus(); // Keep focus on input
    } else {
        console.log('[FileUpload_DEBUG] File selection cancelled or no file chosen (programmatic clear or user cancel).');
        selectedFileForUpload = null;
        chatInput.value = '';
        // Use the safe clear function here. Note: this call will itself trigger clearFileInput,
        // which removes and re-adds listener for the *next* interaction, not current.
        clearFileInput(fileInput);  
    }
}


// Send Chat Message button
sendChatBtn.addEventListener('click', async () => {
    const message = chatInput.value.trim();
    // Clear typing indicator status immediately when message is sent
    if (typingTimeout) clearTimeout(typingTimeout);
    emitTypingStatus(false); // Explicitly send 'not typing'

    // Ensure we are connected via Socket.IO and in a room
    if (!socket.connected || !currentRoomId) {
        console.warn('Cannot send message: Not connected or not in a room.');
        return;
    }

    let fileToUpload = selectedFileForUpload;
    let fileName = fileToUpload?.name || 'File shared.';

    // If sending a captured photo or video
    if (currentPreviewBlob) {
        fileToUpload = currentPreviewBlob;
        if (currentPreviewType === 'image') {
            fileName = `photo_${Date.now()}.png`; // Provide a generic name for upload if image
        } else if (currentPreviewType === 'video') {
            fileName = `video_${Date.now()}.webm`; // Provide a generic name for upload if video
        }
    }


    if (fileToUpload) {
        try {
            const formData = new FormData();
            formData.append('file', fileToUpload, fileName);

            console.log('[FileUpload] Client trying to upload (via FormData):', fileName, 'Type:', fileToUpload.type, 'Size:', fileToUpload.size);

            const response = await fetch('/upload', { method: 'POST', body: formData });  
            
            console.log('[FileUpload] Server response status:', response.status, 'Status Text:', response.statusText);  

            if (response.ok) {
                const data = await response.json();
                console.log('[FileUpload] File upload successful, server URL:', data.url);  
                
                const payload = {
                    type: 'chatMessage',
                    message: message || fileName,
                    fileUrl: data.url,
                    timestamp: new Date().toISOString(),
                    sender: currentUsername,
                    senderId: socket.id
                };

                console.log('[Chat] Emitting "chat:message" to server with file payload:', { ...payload, room: currentRoomId });
                socket.emit('chat:message', { ...payload, room: currentRoomId });
                if (chatDataChannel && chatDataChannel.readyState === 'open') {
                    chatDataChannel.send(JSON.stringify(payload));
                }

            } else {
                console.error('[FileUpload] Server responded with non-OK status:', response.status, response.statusText);  
                const errorText = await response.text();  
                console.error('[FileUpload] Server error response body:', errorText);  
                alert('File upload failed. Server error.');
            }
        } catch (error) {
            console.error('[FileUpload] Client-side error during file upload or processing:', error);  
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
        console.log('[Chat] Emitting "chat:message" to server with text payload:', { ...payload, room: currentRoomId });
        socket.emit('chat:message', { ...payload, room: currentRoomId });
        if (chatDataChannel && chatDataChannel.readyState === 'open') {
            chatDataChannel.send(JSON.stringify(payload));
        }
        chatInput.value = '';
        clearFileInput(fileInput);
    }
});

// Allow sending chat message by pressing Enter
chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault(); // Prevent newline in input field
        sendChatBtn.click(); // Trigger send button click
    }
});

// File input integration (Now using the named function)
fileIcon.addEventListener('click', () => fileInput.click()); // Clicking the icon triggers file input
fileInput.addEventListener('change', handleFileInputChange); // Assign the named function

// --- takePictureBtn Event Listener (from chat controls) ---
// This listener opens the camera POV interface
if (takePictureBtn) {
    console.log('[TakePictureBtn_DEBUG] takePictureBtn element found. Attaching click listener.');
    takePictureBtn.addEventListener('click', () => {
        console.log('[TakePictureBtn_DEBUG] takePictureBtn clicked.');
        console.log('[TakePictureBtn_DEBUG] Current localStream:', localStream);
        if (localStream && localStream.getVideoTracks().length > 0) {
            console.log('[TakePictureBtn_DEBUG] localStream is valid and has video tracks. Opening Camera POV.');
            showCameraPovInterface(); // showCameraPovInterface is in script-base.js
            cameraPovVideo.srcObject = localStream; // Assign local stream to camera POV video
            cameraPovVideo.muted = true; // Mute self-view
            cameraPovVideo.play().catch(e => console.warn('[TakePictureBtn_DEBUG] cameraPovVideo play error:', e));
            // Apply transformation based on current camera facing mode
            applyVideoTransform(cameraPovVideo, currentFacingMode);
        } else {
            console.warn('[TakePictureBtn_DEBUG] Camera stream not available when takePictureBtn was clicked.');
            alert("Camera stream not available. Please ensure camera is enabled.");
        }
    });
} else {
    console.warn('[TakePictureBtn_DEBUG] takePictureBtn element NOT FOUND in DOM. Check index.html and script-base.js definitions.');
}


// --- captureShotBtn Event Handlers (for short press photo, long press video, INSIDE camera POV) ---
if (captureShotBtn) {
    console.log('[CaptureBtn_DEBUG] captureShotBtn element found. Attaching listeners.');
    // Prevent default context menu on long press
    captureShotBtn.addEventListener('contextmenu', (e) => {
        console.log('[CaptureBtn_DEBUG] contextmenu prevented.');
        e.preventDefault();
    });

    const startEvent = 'ontouchstart' in window ? 'touchstart' : 'mousedown';
    const endEvent = 'ontouchend' in window ? 'touchend' : 'mouseup';
    // Use touchcancel for mobile if user drags finger off, mouseleave for desktop
    const leaveEvent = 'ontouchcancel' in window ? 'touchcancel' : 'mouseleave';    

    console.log(`[CaptureBtn_DEBUG] Using startEvent: ${startEvent}, endEvent: ${endEvent}, leaveEvent: ${leaveEvent}`);

    captureShotBtn.addEventListener(startEvent, (e) => {
        console.log(`[CaptureBtn_DEBUG] ${startEvent} triggered. Button: ${e.button}, Type: ${e.type}.`);
        // Ensure only left mouse button or any touch starts the action
        if (e.button === 0 || e.type === 'touchstart') {
            console.log('[CaptureBtn_DEBUG] Valid start event. Clearing existing timer, resetting flags.');
            clearTimeout(longPressTimer);
            isLongPress = false;
            
            longPressTimer = setTimeout(() => {
                isLongPress = true;
                console.log(`[CaptureBtn_DEBUG] Long press threshold (${RECORDING_THRESHOLD_MS}ms) reached. isLongPress set to true.`);
                startRecording();
            }, RECORDING_THRESHOLD_MS);
            
            // Prevent default behavior to avoid scrolling on touch devices or text selection on desktop
            // Only prevent if it's a touchstart for mobile to avoid issues with click on desktop
            if (e.type === 'touchstart') {
                e.preventDefault();  
                console.log('[CaptureBtn_DEBUG] touchstart prevented default.');
            }
        }
    });

    captureShotBtn.addEventListener(endEvent, (e) => {
        console.log(`[CaptureBtn_DEBUG] ${endEvent} triggered.`);
        clearTimeout(longPressTimer);
        console.log('[CaptureBtn_DEBUG] longPressTimer cleared.');

        if (isRecording) {
            console.log('[CaptureBtn_DEBUG] isRecording is true. Calling stopRecording().');
            stopRecording();
        } else if (!isLongPress) {
            console.log('[CaptureBtn_DEBUG] Not recording and not a long press. Calling capturePicture().');
            capturePicture(); // It was a short press
        } else {
            console.log('[CaptureBtn_DEBUG] Neither recording nor short press handled (likely long press timer fired but not recording yet or recording failed).');
        }
        isLongPress = false; // Reset for next press
        console.log('[CaptureBtn_DEBUG] isLongPress reset to false.');
        // Prevent click event on touch devices after touchend has handled the action
        if (e.type === 'touchend') {
            e.preventDefault();
            console.log('[CaptureBtn_DEBUG] touchend prevented default.');
        }
    });

    // Handle cases where pointer leaves the button before mouseup/touchend
    captureShotBtn.addEventListener(leaveEvent, () => {
        console.log(`[CaptureBtn_DEBUG] ${leaveEvent} triggered.`);
        if (!isRecording) { // If recording hasn't started yet, cancel the long press
            console.log('[CaptureBtn_DEBUG] Not recording. Cancelling long press.');
            clearTimeout(longPressTimer);
            isLongPress = false;
        } else {
            console.log('[CaptureBtn_DEBUG] Recording is active. Not cancelling long press from leave event. Recording will stop on release.');
        }
    });
} else {
    console.warn('[CaptureBtn_DEBUG] captureShotBtn element NOT FOUND in DOM. Check index.html and script-base.js definitions.');
}


// Add event listener for the switch camera button
if (switchCamPovBtn) { // Check if the button exists in the DOM
    switchCamPovBtn.addEventListener('click', switchCamera);
    // Initially disable the button until multiple cameras are detected by getLocalStream
    switchCamPovBtn.disabled = true;    
} else {
    console.warn('[Camera_Switch] switchCamPovBtn element NOT FOUND in DOM. Check index.html and script-base.js definitions.');
}


// Back to Call button from Camera POV or Shot Preview
backToCallBtn.addEventListener('click', () => {
    clearPreview(); // Clear preview before going back
    // Ensure recording stops if still active when going back to call interface
    if (isRecording) {
        stopRecording();
    }
    showCallInterface(); // showCallInterface is in script-base.js
});

// Retake Shot button in Shot Preview
retakeShotBtn.addEventListener('click', () => {
    clearPreview(); // Clear current preview
    showCameraPovInterface(); // Go back to camera view
});

// Send Shot button in Shot Preview
sendShotBtn.addEventListener('click', async () => {
    if (!currentPreviewBlob) {
        console.warn('No image or video to send.');
        alert('No photo or video to send!');
        return;
    }
    // Call the main sendChatBtn logic which now handles currentPreviewBlob
    sendChatBtn.click();
    // The finally block in sendChatBtn.click() handles clearing the preview and showing call interface
});


// Add event listener for the puppy icon after the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // All puppy-related code has been removed.
    // The previous manual download listener for saveChatHistoryBtn is intentionally removed.
    // The button remains in HTML but its functionality for manual download is gone.
    // As per new server-side auto-save, this button should ideally be hidden.
    if (saveChatHistoryBtn) {
        saveChatHistoryBtn.style.display = 'none'; // Recommended: hide the button as its function is now automatic/server-side
    }

    // --- Dark Mode Toggle Logic (NEW) ---
    const themeToggle = document.getElementById('themeToggle');
    const themeToggleCall = document.getElementById('themeToggleCall'); // Assuming there's one in the call header too

    function applyThemePreference() {
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme === 'dark') {
            document.body.classList.add('dark-mode');
        } else {
            document.body.classList.remove('dark-mode');
        }
        console.log(`[Theme] Applied theme from localStorage: ${savedTheme || 'light'}`);
    }

    function toggleTheme() {
        const isDarkMode = document.body.classList.contains('dark-mode');
        if (isDarkMode) {
            document.body.classList.remove('dark-mode');
            localStorage.setItem('theme', 'light');
            console.log('[Theme] Switched to Light Mode.');
        } else {
            document.body.classList.add('dark-mode');
            localStorage.setItem('theme', 'dark');
            console.log('[Theme] Switched to Dark Mode.');
        }
    }

    // Apply theme on initial load
    applyThemePreference();

    // Attach event listeners to toggle buttons
    if (themeToggle) {
        themeToggle.addEventListener('click', toggleTheme);
        console.log('[Theme] themeToggle listener attached.');
    } else {
        console.warn('[Theme] themeToggle element NOT FOUND in DOM.');
    }

    if (themeToggleCall) {
        themeToggleCall.addEventListener('click', toggleTheme);
        console.log('[Theme] themeToggleCall listener attached.');
    } else {
        console.warn('[Theme] themeToggleCall element NOT FOUND in DOM.');
    }
});
script-logic.js