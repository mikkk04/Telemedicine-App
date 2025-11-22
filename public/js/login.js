/* Final Version - Cleaned, Verified, and Themed */
'use strict'; // Added strict mode for better code quality and error prevention

// FIX: Establish the Socket.IO connection once and globally.
const socket = io();
const loginForm = document.getElementById('login-form');

loginForm.addEventListener('submit', (event) => {
    event.preventDefault();

    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    if (!username || !password) {
        alert('Please enter both username and password.');
        return;
    }
    
    // FIX: Check if the socket is connected before trying to emit.
    if (!socket.connected) {
        alert('Connection to the server is lost. Please refresh the page and try again.');
        console.error('Socket.IO is not connected. Aborting login attempt.');
        return;
    }

    // Emit login data to the server and wait for a response
    socket.emit('user:login', { username, password }, (response) => {
        if (response.success) {
            // Save user info to local storage for the dashboard pages to use
            localStorage.setItem('telemedicine_user', response.user.username);
            localStorage.setItem('telemedicine_role', response.user.role);

            // Redirect based on role
            if (response.user.role === 'Patient') {
                window.location.href = 'patient-dashboard.html';
            } else if (response.user.role === 'Doctor') {
                window.location.href = 'doctor-dashboard.html';
            } else if (response.user.role === 'Admin') {
                window.location.href = 'admin-dashboard.html';
            } else {
                alert('Role not recognized.');
            }
        } else {
            // Show error message from the server
            alert(response.message);
        }
    });
});

// login.js