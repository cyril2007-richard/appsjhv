import { initializeApp, getApps, getApp } from "firebase/app";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyCaN5cNMQVhGoxYsedMC_QTLMiROan-wPU",
  authDomain: "iris-11574.firebaseapp.com",
  databaseURL: "https://iris-11574-default-rtdb.firebaseio.com",
  projectId: "iris-11574",
  storageBucket: "iris-11574.firebasestorage.app",
  messagingSenderId: "534713737234",
  appId: "1:534713737234:web:f0d688d603e7af026e78cb"
};

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const database = getDatabase(app);

export { app, database };
