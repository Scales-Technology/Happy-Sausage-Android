import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDTFQt3jJc0lp-dOwLF4BaFCJPJOeVgJdo",
  authDomain: "happysausage-application.firebaseapp.com",
  databaseURL: "https://happysausage-application-default-rtdb.firebaseio.com",
  projectId: "happysausage-application",
  storageBucket: "happysausage-application.firebasestorage.app",
  messagingSenderId: "429663349448",
  appId: "1:429663349448:web:00478dcd67d5cd40d113fd",
  measurementId: "G-6V8GCS71FZ"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const firebaseApp = app;

const db = getFirestore(app);

export { db};
