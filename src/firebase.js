// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyAjAXhQMdzeFtRn1funEKZq_H4tCZiCGkQ",
  authDomain: "cloud-code-editor-5a5e2.firebaseapp.com",
  databaseURL: "https://cloud-code-editor-5a5e2-default-rtdb.firebaseio.com",
  projectId: "cloud-code-editor-5a5e2",
  storageBucket: "cloud-code-editor-5a5e2.firebasestorage.app",
  messagingSenderId: "1035181863258",
  appId: "1:1035181863258:web:d94d62bb8997e354a6c363",
  measurementId: "G-DN7Y67XX8M"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();
export const db = getFirestore(app);
const analytics = getAnalytics(app);