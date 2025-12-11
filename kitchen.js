// Kitchen Display System (KDS) for RUCHI
// Uses Firestore realtime listeners to show active and ready orders
// TODO: Add filter by station or category if needed later

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, collection, query, where, onSnapshot, updateDoc, doc, orderBy } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// Firebase initialization snippet (reuse project config)
const firebaseConfig = {
    apiKey: "AIzaSyCS1WJJQ7QQnqRhtwuTQCPpjjb3tIjQ3nQ",
    authDomain: "ruchi-53a14.firebaseapp.com",
    projectId: "ruchi-53a14",
    storageBucket: "ruchi-53a14.appspot.com",
    messagingSenderId: "473906899822",
    appId: "1:473906899822:web:07640feeca4e379aaa6f7f",
    measurementId: "G-J1CQDC048C"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// DOM references
const inKitchenEl = document.getElementById("in-kitchen");
const updatedAtEl = document.getElementById("updated-at");
const notifyAudio = document.getElementById("notify-audio");

// Track seen orders to identify new arrivals for sound/highlight
const seenInKitchen = new Set();
const orderMap = new Map();

// Format a Firestore timestamp (number or Timestamp) to readable time
const formatTimestamp = (ts) => {
    if (!ts) return "";
    const value = typeof ts === "number" ? ts : ts?.toMillis?.();
    if (!value) return "";
    const d = new Date(value);
    return d.toLocaleString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        month: "short",
        day: "numeric"
    });
};

// Create a pill element for service type
const servicePill = (service) => {
    const span = document.createElement("span");
    const isDineIn = (service || "").toLowerCase() === "dine-in";
    span.className = `pill ${isDineIn ? "dine" : "take"}`;
    span.textContent = isDineIn ? "Dine-in" : "Takeaway";
    return span;
};

// Render an order card; highlight if new
const renderCard = (order, isNew, onReadyClick) => {
    const card = document.createElement("div");
    card.className = "order-card";
    if (isNew) card.classList.add("new");

    const header = document.createElement("div");
    header.className = "order-header";

    const idEl = document.createElement("div");
    idEl.className = "order-id";
    idEl.textContent = order.orderId || "Order";

    const tags = document.createElement("div");
    tags.style.display = "flex";
    tags.style.gap = "6px";
    tags.style.flexWrap = "wrap";
    tags.style.alignItems = "center";

    const tablePill = document.createElement("span");
    tablePill.className = "pill table";
    tablePill.textContent = `Table ${order.table || "-"}`;

    tags.appendChild(tablePill);
    tags.appendChild(servicePill(order.service));

    header.appendChild(idEl);
    header.appendChild(tags);

    const itemsList = document.createElement("ul");
    itemsList.className = "items";

    const kitchenItems = (order.items || []).filter((it) => (it?.prep || "").toLowerCase() === "kitchen");
    if (!kitchenItems.length) {
        const li = document.createElement("li");
        li.textContent = "No kitchen items.";
        itemsList.appendChild(li);
    } else {
        kitchenItems.forEach((item) => {
            const li = document.createElement("li");
            const qty = item.qty || 1;
            li.textContent = `${qty} × ${item.name || "Item"}`;
            itemsList.appendChild(li);
        });
    }

    card.appendChild(header);
    card.appendChild(itemsList);

    if (order.notes) {
        const notes = document.createElement("p");
        notes.className = "notes";
        notes.textContent = `Notes: ${order.notes}`;
        card.appendChild(notes);
    }

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = formatTimestamp(order.timestamp);
    card.appendChild(meta);

    if (onReadyClick) {
        const btn = document.createElement("button");
        btn.className = "btn";
        btn.type = "button";
        btn.textContent = "Mark as Ready";
        btn.addEventListener("click", async () => {
            card.classList.add("processing");
            btn.disabled = true;
            try {
                await onReadyClick(order);
            } catch (err) {
                card.classList.remove("processing");
                btn.disabled = false;
                console.error(err);
            }
        });
        card.appendChild(btn);
    }

    return card;
};

// Render list utility
const renderList = (container, orders, opts = {}) => {
    container.innerHTML = "";
    if (!orders.length) {
        const empty = document.createElement("div");
        empty.className = "empty";
        empty.textContent = opts.emptyText || "No orders.";
        container.appendChild(empty);
        return;
    }
    orders.forEach((order) => {
        const card = renderCard(order, opts.newIds?.has(order.id), opts.onReadyClick);
        if (order.orderStatus === "ready") card.classList.add("ready");
        container.appendChild(card);
    });
};

// Play notification for new arrivals
const playNotify = () => {
    if (!notifyAudio) return;
    notifyAudio.currentTime = 0;
    notifyAudio.play().catch(() => {/* ignored to avoid blocking UI */});
};

// Mark order as ready: update Firestore
const handleMarkReady = async (order) => {
    if (!order?.id) return;
    try {
        const ref = doc(db, "orders", order.id);
        await updateDoc(ref, { orderStatus: "ready" });
    } catch (err) {
        console.error("Failed to mark ready", err);
        throw err;
    }
};

const renderCombined = (newIds) => {
    const all = Array.from(orderMap.values())
        .filter((o) => o.orderStatus === "in-kitchen" || o.orderStatus === "ready")
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)); // latest on top

    renderList(inKitchenEl, all, {
        newIds,
        onReadyClick: handleMarkReady,
        emptyText: "Waiting for orders",
    });
    updatedAtEl.textContent = `Updated: ${new Date().toLocaleTimeString()}`;
};

// Listen for in-kitchen orders
const listenInKitchen = () => {
    const q = query(
        collection(db, "orders"),
        where("orderStatus", "==", "in-kitchen"),
        orderBy("timestamp", "desc")
    );

    onSnapshot(q, (snapshot) => {
        const newIds = new Set();
        snapshot.docs.forEach((docSnap) => {
            const data = docSnap.data();
            const order = { ...data, id: docSnap.id };
            if (!seenInKitchen.has(docSnap.id)) {
                newIds.add(docSnap.id);
                seenInKitchen.add(docSnap.id);
            }
            orderMap.set(docSnap.id, order);
        });
        renderCombined(newIds);
        if (newIds.size) playNotify();
    }, (error) => {
        console.error("listenInKitchen error", error);
    });
};

// Listen for ready orders (keep them blurred but visible)
const listenReady = () => {
    const q = query(
        collection(db, "orders"),
        where("orderStatus", "==", "ready"),
        orderBy("timestamp", "desc")
    );

    onSnapshot(q, (snapshot) => {
        snapshot.docs.forEach((docSnap) => {
            const data = docSnap.data();
            const order = { ...data, id: docSnap.id };
            orderMap.set(docSnap.id, order);
        });
        renderCombined(new Set());
    }, (error) => {
        console.error("listenReady error", error);
    });
};

// Kick off listeners
listenInKitchen();
listenReady();
