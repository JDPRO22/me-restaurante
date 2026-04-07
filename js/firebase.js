import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { getFirestore, collection, doc, getDocs, addDoc, setDoc, deleteDoc, onSnapshot, query, orderBy, updateDoc, writeBatch, getDoc } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

export function createDb(firebaseConfig) {
    const app = initializeApp(firebaseConfig);
    return getFirestore(app);
}

export {
    addDoc,
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    onSnapshot,
    orderBy,
    query,
    setDoc,
    updateDoc,
    writeBatch
};
