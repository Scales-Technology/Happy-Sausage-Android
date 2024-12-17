import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyB5xP5p6oa4KPgy5SU0Ryd7AztQ2LVidVE",
  authDomain: "warehousesystem-cf290.firebaseapp.com",
  projectId: "warehousesystem-cf290",
  storageBucket: "warehousesystem-cf290.firebasestorage.app",
  messagingSenderId: "694531549824",
  appId: "1:694531549824:web:189201eb7cb948a6621465",
  measurementId: "G-GS1QRY939D"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const firebaseApp = app;

const db = getFirestore(app);

export { db};
