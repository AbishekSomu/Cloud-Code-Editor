// firebase.js
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, setPersistence, browserLocalPersistence } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getAnalytics } from "firebase/analytics";


// Use the config you previously posted — kept here so the app will run without further setup.
const firebaseConfig = {
apiKey: "AIzaSyAjAXhQMdzeFtRn1funEKZq_H4tCZiCGkQ",
authDomain: "cloud-code-editor-5a5e2.firebaseapp.com",
databaseURL: "https://cloud-code-editor-5a5e2-default-rtdb.firebaseio.com",
projectId: "cloud-code-editor-5a5e2",
storageBucket: "cloud-code-editor-5a5e2.firebasestorage.app",
messagingSenderId: "1035181863258",
appId: "1:1035181863258:web:d94d62bb8997e354a6c363",
measurementId: "G-DN7Y67XX8M",
};


const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence).catch(() => {});
export const provider = new GoogleAuthProvider();
export const db = getFirestore(app);


// analytics is optional — wrapped in try/catch to avoid issues in environments without window
try {
getAnalytics(app);
} catch (e) {
// ignore in non-browser / if blocked
}


export default app;
