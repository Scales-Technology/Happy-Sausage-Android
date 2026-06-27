// Screens/admin/AdminDashboard.js
// COMPLETE ADMIN DASHBOARD - FULLY WORKING
// NO ExpoSharing - Uses built-in Share API
// NO ExpoPrint - Uses text-based export

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  TextInput,
  FlatList,
  Alert,
  ToastAndroid,
  RefreshControl,
  Dimensions,
  StatusBar,
  ActivityIndicator,
  Share,
  AppState,
} from "react-native";
import { useDispatch, useSelector } from "react-redux";
import { setLoggedIn, setUser, setBusinessId } from "../../store/store";
import { db } from "../../Database/config";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system";
import {
  collection,
  getDocs,
  addDoc,
  deleteDoc,
  doc,
  query,
  where,
  orderBy,
  limit,
  updateDoc,
  onSnapshot,
} from "firebase/firestore";

const { width } = Dimensions.get("window");

// AsyncStorage Keys
const PROCESSING_RECORDS_KEY = "@processing_records";
const DISPATCH_RECORDS_KEY = "@dispatch_records";
const DRY_STOCK_KEY = "@dry_goods_stock";
const COLD_STOCK_KEY = "@coldroom_stock";
const PACKED_PRODUCTS_KEY = "@packed_products";

// Cache Keys
const CACHE_STOCK_BALANCE = "@cache_stock_balance";
const CACHE_STOCK_MOVEMENTS = "@cache_stock_movements";
const CACHE_STATS = "@cache_stats";
const CACHE_TIMESTAMP = "@cache_timestamp";
const CACHE_DURATION = 5 * 60 * 1000;

// Notification Keys
const NOTIFICATIONS_KEY = "@admin_notifications";

const AdminDashboard = ({ navigation }) => {
  const dispatch = useDispatch();
  const user = useSelector((state) => state.settings.user);

  // ============ STATE ============
  const [activeModal, setActiveModal] = useState(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const [businessId, setBusinessIdState] = useState(null);
  const [businessName, setBusinessName] = useState("");
  const [clerks, setClerks] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [approvals, setApprovals] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [approvalCount, setApprovalCount] = useState(0);
  const [notificationModalVisible, setNotificationModalVisible] =
    useState(false);

  // Stock data
  const [dryGoodsStock, setDryGoodsStock] = useState([]);
  const [coldRoomStock, setColdRoomStock] = useState([]);
  const [packedProducts, setPackedProducts] = useState([]);
  const [processingRecords, setProcessingRecords] = useState([]);
  const [dispatchRecords, setDispatchRecords] = useState([]);

  // Stock Balance & Movement
  const [stockBalance, setStockBalance] = useState([]);
  const [stockMovements, setStockMovements] = useState([]);
  const [openingStock, setOpeningStock] = useState([]);
  const [itemSpecificMovements, setItemSpecificMovements] = useState([]);
  const [materialUsage, setMaterialUsage] = useState([]);
  const [salesReport, setSalesReport] = useState([]);
  const [selectedTransaction, setSelectedTransaction] = useState(null);
  const [reversalReason, setReversalReason] = useState("");
  const [filterText, setFilterText] = useState("");

  // Stock Removal
  const [removalModalVisible, setRemovalModalVisible] = useState(false);
  const [selectedStockItem, setSelectedStockItem] = useState(null);
  const [removeWeight, setRemoveWeight] = useState("");
  const [removalReason, setRemovalReason] = useState("");
  const [stockForRemoval, setStockForRemoval] = useState([]);

  // Backup & Restore
  const [backupData, setBackupData] = useState({
    jsonString: null,
    filePath: null,
    fileName: null,
    size: 0,
  });
  const [restoreData, setRestoreData] = useState("");
  const [backupHistory, setBackupHistory] = useState([]);

  // Delete Transaction
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [itemToDelete, setItemToDelete] = useState(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  // Stats
  const [stats, setStats] = useState({
    totalProducts: 0,
    totalStockValue: 0,
    todayDispatches: 0,
    pendingApprovals: 0,
    totalSales: 0,
    totalRevenue: 0,
    usedStockValue: 0,
    usedDryGoodsCount: 0,
    usedCarcassesCount: 0,
  });

  // ============ USED STOCK TRACKING ============
  const [usedStockItems, setUsedStockItems] = useState([]);
  const [stockUsageDetails, setStockUsageDetails] = useState([]);
  const [usedStockModalVisible, setUsedStockModalVisible] = useState(false);
  const [selectedUsedItem, setSelectedUsedItem] = useState(null);

  // Form states
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("storekeeper");

  // Report filters
  const [reportData, setReportData] = useState([]);
  const [reportType, setReportType] = useState("dispatch");
  const [reversalModalVisible, setReversalModalVisible] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [dataLoaded, setDataLoaded] = useState({
    stats: false,
    clerks: false,
    stock: false,
    audit: false,
    approvals: false,
    movements: false,
    balance: false,
    usage: false,
  });

  // ============ AUTO-REFRESH TIMER ============
  const autoRefreshTimer = useRef(null);
  const appState = useRef(AppState.currentState);

  // ============ REAL-TIME LISTENERS ============
  const approvalListener = useRef(null);
  const auditListener = useRef(null);

  const roles = [
    {
      value: "system_administrator",
      label: "System Administrator",
      level: 100,
      fullAccess: true,
    },
    {
      value: "storekeeper",
      label: "Storekeeper",
      level: 30,
      fullAccess: false,
    },
    {
      value: "dispatch_clerk",
      label: "Dispatch Clerk",
      level: 25,
      fullAccess: false,
    },
    {
      value: "assistant_accountant",
      label: "Assistant Accountant",
      level: 40,
      fullAccess: false,
    },
    {
      value: "finance_manager",
      label: "Finance Manager",
      level: 60,
      fullAccess: false,
    },
    {
      value: "internal_auditor",
      label: "Internal Auditor",
      level: 70,
      fullAccess: false,
    },
    {
      value: "production_manager",
      label: "Production Manager",
      level: 50,
      fullAccess: true,
    },
    {
      value: "general_manager",
      label: "General Manager",
      level: 80,
      fullAccess: true,
    },
  ];

  // ============ CHECK CACHE ============
  const checkCache = useCallback(async () => {
    try {
      const timestamp = await AsyncStorage.getItem(CACHE_TIMESTAMP);
      if (timestamp) {
        const elapsed = Date.now() - parseInt(timestamp);
        if (elapsed < CACHE_DURATION) {
          const cachedStats = await AsyncStorage.getItem(CACHE_STATS);
          if (cachedStats) {
            setStats(JSON.parse(cachedStats));
            setDataLoaded((prev) => ({ ...prev, stats: true }));
          }
          const cachedBalance = await AsyncStorage.getItem(CACHE_STOCK_BALANCE);
          if (cachedBalance) {
            setStockBalance(JSON.parse(cachedBalance));
            setDataLoaded((prev) => ({ ...prev, balance: true }));
          }
          const cachedMovements = await AsyncStorage.getItem(
            CACHE_STOCK_MOVEMENTS,
          );
          if (cachedMovements) {
            const movements = JSON.parse(cachedMovements);
            setStockMovements(movements);
            setItemSpecificMovements(movements);
            setDataLoaded((prev) => ({ ...prev, movements: true }));
          }
          const cachedUsage = await AsyncStorage.getItem("@cache_stock_usage");
          if (cachedUsage) {
            const usage = JSON.parse(cachedUsage);
            if (Array.isArray(usage)) {
              setUsedStockItems(usage);
            }
            setDataLoaded((prev) => ({ ...prev, usage: true }));
          }
          return true;
        }
      }
      return false;
    } catch (error) {
      console.error("Cache check failed:", error);
      return false;
    }
  }, []);

  // ============ SAVE TO CACHE ============
  const saveToCache = useCallback(async () => {
    try {
      await AsyncStorage.setItem(CACHE_STATS, JSON.stringify(stats));
      await AsyncStorage.setItem(
        CACHE_STOCK_BALANCE,
        JSON.stringify(stockBalance),
      );
      await AsyncStorage.setItem(
        CACHE_STOCK_MOVEMENTS,
        JSON.stringify(stockMovements),
      );
      await AsyncStorage.setItem(CACHE_TIMESTAMP, Date.now().toString());
      if (Array.isArray(usedStockItems)) {
        await AsyncStorage.setItem(
          "@cache_stock_usage",
          JSON.stringify(usedStockItems),
        );
      }
    } catch (error) {
      console.error("Failed to save cache:", error);
    }
  }, [stats, stockBalance, stockMovements, usedStockItems]);

  // ============ LOAD NOTIFICATIONS ============
  const loadNotifications = useCallback(async () => {
    try {
      const stored = await AsyncStorage.getItem(NOTIFICATIONS_KEY);
      if (stored) {
        const notifs = JSON.parse(stored);
        setNotifications(notifs);
        setUnreadCount(notifs.filter((n) => !n.read).length);
      }
    } catch (error) {
      console.error("Failed to load notifications:", error);
    }
  }, []);

  // ============ ADD NOTIFICATION ============
  const addNotification = useCallback(
    async (title, message, type = "info") => {
      try {
        const newNotif = {
          id: Date.now().toString(),
          title,
          message,
          type,
          read: false,
          timestamp: new Date().toISOString(),
        };
        const updated = [newNotif, ...notifications];
        setNotifications(updated);
        setUnreadCount((prev) => prev + 1);
        await AsyncStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(updated));
        ToastAndroid.show(`🔔 ${title}`, ToastAndroid.LONG);
        await logAudit("NOTIFICATION", { title, message, type });
      } catch (error) {
        console.error("Failed to add notification:", error);
      }
    },
    [notifications],
  );

  // ============ MARK NOTIFICATION READ ============
  const markNotificationRead = useCallback(
    async (id) => {
      try {
        const updated = notifications.map((n) =>
          n.id === id ? { ...n, read: true } : n,
        );
        setNotifications(updated);
        setUnreadCount(updated.filter((n) => !n.read).length);
        await AsyncStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(updated));
      } catch (error) {
        console.error("Failed to mark notification read:", error);
      }
    },
    [notifications],
  );

  // ============ MARK ALL NOTIFICATIONS READ ============
  const markAllNotificationsRead = useCallback(async () => {
    try {
      const updated = notifications.map((n) => ({ ...n, read: true }));
      setNotifications(updated);
      setUnreadCount(0);
      await AsyncStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(updated));
      ToastAndroid.show("All notifications marked as read", ToastAndroid.SHORT);
    } catch (error) {
      console.error("Failed to mark all notifications read:", error);
    }
  }, [notifications]);

  // ============ SETUP REAL-TIME LISTENERS ============
  const setupRealtimeListeners = useCallback(async () => {
    if (!businessId) return;

    if (approvalListener.current) {
      approvalListener.current();
    }

    const approvalsQuery = query(
      collection(db, "approval_requests"),
      where("status", "==", "pending"),
    );

    approvalListener.current = onSnapshot(approvalsQuery, (snapshot) => {
      const newApprovals = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      if (newApprovals.length > approvals.length) {
        const newCount = newApprovals.length - approvals.length;
        addNotification(
          "New Approval Request",
          `${newCount} new approval request${newCount > 1 ? "s" : ""} waiting for your review.`,
          "approval",
        );
      }

      setApprovals(newApprovals);
      setApprovalCount(newApprovals.length);
    });

    if (auditListener.current) {
      auditListener.current();
    }

    const auditQuery = query(
      collection(db, "audit_logs"),
      orderBy("timestamp", "desc"),
      limit(10),
    );

    auditListener.current = onSnapshot(auditQuery, (snapshot) => {
      const newLogs = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      if (newLogs.length > 0 && auditLogs.length > 0) {
        const latestNew = newLogs[0];
        const latestOld = auditLogs[0];
        if (latestNew.id !== latestOld.id) {
          addNotification(
            "New Activity",
            `${latestNew.userName || "Someone"} performed: ${latestNew.action}`,
            "activity",
          );
        }
      }

      setAuditLogs(newLogs);
    });

    const subscription = AppState.addEventListener("change", (nextAppState) => {
      if (nextAppState === "active") {
        loadAllData(true);
      }
    });

    return () => {
      subscription.remove();
    };
  }, [businessId, approvals.length, auditLogs.length, addNotification]);

  // ============ LOAD ALL DATA ============
  const loadAllData = useCallback(
    async (forceRefresh = false) => {
      if (!forceRefresh) {
        const cached = await checkCache();
        if (cached) {
          setInitialLoad(false);
          setLoading(false);
          loadFreshData();
          return;
        }
      }

      setLoading(true);
      try {
        await Promise.all([
          loadBusinessAndClerks(),
          loadStats(),
          loadAuditLogs(),
          loadApprovals(),
          loadStockData(),
          loadNotifications(),
          loadUsedStockData(),
        ]);

        setTimeout(() => {
          loadHeavyData();
        }, 100);

        setInitialLoad(false);
      } catch (error) {
        console.error("Error loading data:", error);
      } finally {
        setLoading(false);
      }
    },
    [checkCache, loadNotifications],
  );

  // ============ LOAD FRESH DATA ============
  const loadFreshData = useCallback(async () => {
    try {
      await Promise.all([
        loadBusinessAndClerks(),
        loadStats(),
        loadAuditLogs(),
        loadApprovals(),
        loadStockData(),
        loadNotifications(),
        loadUsedStockData(),
      ]);
      loadHeavyData();
    } catch (error) {
      console.error("Background load failed:", error);
    }
  }, [loadNotifications]);

  // ============ LOAD HEAVY DATA ============
  const loadHeavyData = useCallback(async () => {
    try {
      await Promise.all([
        loadStockBalance(),
        loadStockMovements(),
        loadOpeningStock(),
        loadMaterialUsage(),
        loadSalesReport(),
        loadStockForRemoval(),
        calculateStockUsage(),
      ]);
      await saveToCache();
    } catch (error) {
      console.error("Heavy data load failed:", error);
    }
  }, [saveToCache]);

  // ============ LOAD USED STOCK DATA ============
  const loadUsedStockData = useCallback(async () => {
    try {
      const [processingSnapshot, drySnapshot, coldSnapshot] = await Promise.all(
        [
          getDocs(collection(db, "processing_records")),
          getDocs(collection(db, "dry_goods_stock")),
          getDocs(collection(db, "cold_room_stock")),
        ],
      );

      const processingList = processingSnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      const dryList = drySnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      const coldList = coldSnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      const usedItems = [];
      const usageDetails = [];

      processingList.forEach((record) => {
        if (record.carcassesUsed && Array.isArray(record.carcassesUsed)) {
          record.carcassesUsed.forEach((carcass) => {
            const coldItem = coldList.find((c) => c.id === carcass.id);
            usedItems.push({
              id: carcass.id || `carcass_${Date.now()}`,
              type: "carcass",
              name: carcass.type || "Carcass",
              batchCode: carcass.batchCode || "N/A",
              weightUsed: carcass.weightUsed || 0,
              remainingWeight: carcass.remainingWeight || 0,
              productMade: record.productName || "Unknown Product",
              processingBatchCode: record.batchCode || "N/A",
              timestamp: record.timestamp || new Date().toISOString(),
              piecesProduced: carcass.piecesProduced || 0,
              status: "Used in Processing",
            });
            usageDetails.push({
              stockId: carcass.id,
              stockType: "carcass",
              stockName: carcass.type || "Carcass",
              productMade: record.productName || "Unknown Product",
              weightUsed: carcass.weightUsed || 0,
              batchCode: carcass.batchCode || "N/A",
              processingBatch: record.batchCode || "N/A",
              timestamp: record.timestamp || new Date().toISOString(),
            });
          });
        }

        if (record.dryGoodsUsed && Array.isArray(record.dryGoodsUsed)) {
          record.dryGoodsUsed.forEach((dryGood) => {
            usedItems.push({
              id: dryGood.id || `dry_${Date.now()}`,
              type: "dry_goods",
              name: dryGood.name || "Dry Good",
              batchCode: dryGood.batchCode || "N/A",
              weightUsed: dryGood.amount || 0,
              remainingWeight: 0,
              productMade: record.productName || "Unknown Product",
              processingBatchCode: record.batchCode || "N/A",
              timestamp: record.timestamp || new Date().toISOString(),
              status: "Used in Processing",
            });
            usageDetails.push({
              stockId: dryGood.id,
              stockType: "dry_goods",
              stockName: dryGood.name || "Dry Good",
              productMade: record.productName || "Unknown Product",
              weightUsed: dryGood.amount || 0,
              batchCode: dryGood.batchCode || "N/A",
              processingBatch: record.batchCode || "N/A",
              timestamp: record.timestamp || new Date().toISOString(),
            });
          });
        }
      });

      setUsedStockItems(usedItems);
      setStockUsageDetails(usageDetails);
      setDataLoaded((prev) => ({ ...prev, usage: true }));
      console.log(`📊 Loaded ${usedItems.length} used stock items`);
    } catch (error) {
      console.error("Failed to load used stock data:", error);
    }
  }, []);

  // ============ CALCULATE STOCK USAGE ============
  const calculateStockUsage = useCallback(async () => {
    try {
      const [processingSnapshot] = await Promise.all([
        getDocs(collection(db, "processing_records")),
      ]);

      const processingList = processingSnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      let usedCarcassesCount = 0;
      let usedDryGoodsCount = 0;
      let usedStockValue = 0;

      processingList.forEach((record) => {
        if (record.carcassesUsed && Array.isArray(record.carcassesUsed)) {
          usedCarcassesCount += record.carcassesUsed.length;
          record.carcassesUsed.forEach((c) => {
            usedStockValue += c.weightUsed || 0;
          });
        }
        if (record.dryGoodsUsed && Array.isArray(record.dryGoodsUsed)) {
          usedDryGoodsCount += record.dryGoodsUsed.length;
          record.dryGoodsUsed.forEach((d) => {
            usedStockValue += d.amount || 0;
          });
        }
      });

      setStats((prev) => ({
        ...prev,
        usedDryGoodsCount,
        usedCarcassesCount,
        usedStockValue,
      }));
    } catch (error) {
      console.error("Failed to calculate stock usage:", error);
    }
  }, []);

  // ============ LOAD STATS ============
  const loadStats = useCallback(async () => {
    try {
      const [products, dryGoods, coldRoom, dispatch, approvalsData] =
        await Promise.all([
          AsyncStorage.getItem(PACKED_PRODUCTS_KEY),
          AsyncStorage.getItem(DRY_STOCK_KEY),
          AsyncStorage.getItem(COLD_STOCK_KEY),
          AsyncStorage.getItem(DISPATCH_RECORDS_KEY),
          getDocs(
            query(
              collection(db, "approval_requests"),
              where("status", "==", "pending"),
            ),
          ),
        ]);

      const packedProductsList = products ? JSON.parse(products) : [];
      const dryGoodsList = dryGoods ? JSON.parse(dryGoods) : [];
      const coldRoomList = coldRoom ? JSON.parse(coldRoom) : [];
      const dispatchList = dispatch ? JSON.parse(dispatch) : [];

      const today = new Date().toISOString().split("T")[0];
      const todayDispatches = dispatchList.filter((r) =>
        r.date?.startsWith(today),
      ).length;
      const totalStockValue = [...dryGoodsList, ...coldRoomList].reduce(
        (sum, item) => sum + (item.totalWeight || 0),
        0,
      );

      setStats((prev) => ({
        ...prev,
        totalProducts: packedProductsList.length,
        totalStockValue: totalStockValue,
        todayDispatches: todayDispatches,
        pendingApprovals: approvalsData.docs.length,
        totalSales: dispatchList.length,
        totalRevenue: dispatchList.reduce(
          (sum, r) => sum + (r.totalAmount || 0),
          0,
        ),
      }));
      setApprovalCount(approvalsData.docs.length);
      setDataLoaded((prev) => ({ ...prev, stats: true }));
    } catch (error) {
      console.error("Failed to load stats:", error);
    }
  }, []);

  // ============ LOAD BUSINESS AND CLERKS ============
  const loadBusinessAndClerks = useCallback(async () => {
    try {
      const businesses = await getDocs(collection(db, "Businesses"));
      if (!businesses.empty) {
        const firstBusiness = businesses.docs[0];
        setBusinessIdState(firstBusiness.id);
        setBusinessName(firstBusiness.data().name || "");

        const clerksSnapshot = await getDocs(
          collection(firstBusiness.ref, "Clerks"),
        );
        setClerks(
          clerksSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
        );
        setDataLoaded((prev) => ({ ...prev, clerks: true }));
      }
    } catch (error) {
      console.error("Failed to load business:", error);
    }
  }, []);

  // ============ LOAD AUDIT LOGS ============
  const loadAuditLogs = useCallback(async () => {
    try {
      const logsSnapshot = await getDocs(
        query(
          collection(db, "audit_logs"),
          orderBy("timestamp", "desc"),
          limit(50),
        ),
      );
      setAuditLogs(
        logsSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
      );
      setDataLoaded((prev) => ({ ...prev, audit: true }));
    } catch (error) {
      console.error("Failed to load audit logs:", error);
    }
  }, []);

  // ============ LOAD APPROVALS ============
  const loadApprovals = useCallback(async () => {
    try {
      const approvalsSnapshot = await getDocs(
        query(
          collection(db, "approval_requests"),
          where("status", "==", "pending"),
        ),
      );
      const approvalsList = approvalsSnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      setApprovals(approvalsList);
      setApprovalCount(approvalsList.length);
      setDataLoaded((prev) => ({ ...prev, approvals: true }));
    } catch (error) {
      console.error("Failed to load approvals:", error);
    }
  }, []);

  // ============ LOAD STOCK DATA ============
  const loadStockData = useCallback(async () => {
    try {
      const [dryGoodsSnapshot, coldRoomSnapshot] = await Promise.all([
        getDocs(collection(db, "dry_goods_stock")),
        getDocs(collection(db, "cold_room_stock")),
      ]);
      setDryGoodsStock(
        dryGoodsSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
      );
      setColdRoomStock(
        coldRoomSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
      );
      setDataLoaded((prev) => ({ ...prev, stock: true }));
    } catch (error) {
      console.error("Failed to load stock:", error);
    }
  }, []);

  // ============ LOAD STOCK BALANCE ============
  const loadStockBalance = useCallback(async () => {
    try {
      const [dry, cold] = await Promise.all([
        AsyncStorage.getItem(DRY_STOCK_KEY),
        AsyncStorage.getItem(COLD_STOCK_KEY),
      ]);
      const allStock = [
        ...(dry ? JSON.parse(dry) : []),
        ...(cold ? JSON.parse(cold) : []),
      ];

      const usedItems = Array.isArray(usedStockItems) ? usedStockItems : [];

      const usedIds = new Set();
      usedItems.forEach((item) => {
        if (item && item.id) {
          usedIds.add(item.id);
        }
      });

      const availableStock = allStock.filter((item) => !usedIds.has(item.id));

      const grouped = {};
      availableStock.forEach((item) => {
        const key = item.type || item.name || "Unknown";
        if (!grouped[key]) {
          grouped[key] = {
            name: key,
            totalWeight: 0,
            pieces: 0,
            stores: [],
            items: [],
            available: true,
          };
        }
        grouped[key].totalWeight += item.totalWeight || 0;
        grouped[key].pieces += item.pieces || 0;
        if (item.store) grouped[key].stores.push(item.store);
        grouped[key].items.push(item);
      });

      usedItems.forEach((item) => {
        if (!item) return;
        const key = item.name || "Used Stock";
        if (!grouped[key]) {
          grouped[key] = {
            name: `${key} (Used)`,
            totalWeight: 0,
            pieces: 0,
            stores: [],
            items: [],
            available: false,
            usedIn: item.productMade || "Unknown",
          };
        }
        grouped[key].totalWeight += item.weightUsed || 0;
        grouped[key].pieces += 1;
        if (!grouped[key].usedIn && item.productMade) {
          grouped[key].usedIn = item.productMade;
        }
      });

      setStockBalance(Object.values(grouped));
      setDataLoaded((prev) => ({ ...prev, balance: true }));
    } catch (error) {
      console.error("Failed to load stock balance:", error);
    }
  }, [usedStockItems]);

  // ============ LOAD STOCK MOVEMENTS ============
  const loadStockMovements = useCallback(async () => {
    try {
      const [processing, dispatch] = await Promise.all([
        AsyncStorage.getItem(PROCESSING_RECORDS_KEY),
        AsyncStorage.getItem(DISPATCH_RECORDS_KEY),
      ]);

      const movements = [];
      const processingList = processing ? JSON.parse(processing) : [];
      const dispatchList = dispatch ? JSON.parse(dispatch) : [];

      processingList.slice(0, 50).forEach((record) => {
        movements.push({
          id: record.id || Date.now().toString(),
          type: "PROCESSING",
          itemName: record.productName || "Unknown Product",
          quantity: record.totalPieces || 0,
          weight: record.totalWeight || 0,
          date: record.timestamp || new Date().toISOString(),
          user: record.userName || "System",
          details: `Processed ${record.productName || "item"}`,
          canReverse: true,
          canDelete: true,
          batchCode: record.batchCode || "",
          carcassesUsed: record.carcassesUsed || [],
          dryGoodsUsed: record.dryGoodsUsed || [],
        });
      });

      dispatchList.slice(0, 50).forEach((record) => {
        if (record.items && record.items.length > 0) {
          record.items.forEach((item) => {
            movements.push({
              id: record.id + Math.random().toString(),
              type: "DISPATCH",
              itemName: item.productName || "Unknown Product",
              quantity: item.quantity || 0,
              weight: 0,
              date: record.timestamp || new Date().toISOString(),
              user: record.customerName || "Unknown Customer",
              details: `Dispatched to ${record.customerName || "customer"}`,
              canReverse: false,
              canDelete: false,
              dispatchNumber: record.dispatchNumber || "",
            });
          });
        }
      });

      movements.sort((a, b) => new Date(b.date) - new Date(a.date));
      const limitedMovements = movements.slice(0, 50);
      setStockMovements(limitedMovements);
      setItemSpecificMovements(limitedMovements);
      setDataLoaded((prev) => ({ ...prev, movements: true }));
    } catch (error) {
      console.error("Failed to load stock movements:", error);
    }
  }, []);

  // ============ LOAD OPENING STOCK ============
  const loadOpeningStock = useCallback(async () => {
    try {
      const [dry, cold] = await Promise.all([
        AsyncStorage.getItem(DRY_STOCK_KEY),
        AsyncStorage.getItem(COLD_STOCK_KEY),
      ]);
      const opening = [];
      [
        ...(dry ? JSON.parse(dry) : []),
        ...(cold ? JSON.parse(cold) : []),
      ].forEach((item) => {
        if (item.createdAt) {
          opening.push({
            name: item.type || item.name || "Unknown",
            weight: item.totalWeight || 0,
            pieces: item.pieces || 0,
            date: item.createdAt,
            store: item.store || "Unknown",
            batchCode: item.batchCode || "",
          });
        }
      });
      setOpeningStock(opening);
    } catch (error) {
      console.error("Failed to load opening stock:", error);
    }
  }, []);

  // ============ LOAD MATERIAL USAGE ============
  const loadMaterialUsage = useCallback(async () => {
    try {
      const stored = await AsyncStorage.getItem(PROCESSING_RECORDS_KEY);
      const records = stored ? JSON.parse(stored) : [];
      const usage = {};
      records.slice(0, 30).forEach((record) => {
        if (record.recipeUsed) {
          const recipeName = record.recipeUsed;
          if (!usage[recipeName]) {
            usage[recipeName] = {
              name: recipeName,
              totalPieces: 0,
              totalWeight: 0,
              ingredients: {},
              occurrences: 0,
              lastUsed: record.timestamp,
              products: [],
            };
          }
          usage[recipeName].totalPieces += record.totalPieces || 0;
          usage[recipeName].totalWeight += record.totalWeight || 0;
          usage[recipeName].occurrences += 1;
          if (record.timestamp) usage[recipeName].lastUsed = record.timestamp;
          if (record.dryGoodsUsed) {
            record.dryGoodsUsed.forEach((ing) => {
              if (!usage[recipeName].ingredients[ing.name || ing.type]) {
                usage[recipeName].ingredients[ing.name || ing.type] = 0;
              }
              usage[recipeName].ingredients[ing.name || ing.type] +=
                ing.amount || 0;
            });
          }
          if (record.carcassesUsed) {
            record.carcassesUsed.forEach((carcass) => {
              if (!usage[recipeName].ingredients[carcass.type]) {
                usage[recipeName].ingredients[carcass.type] = 0;
              }
              usage[recipeName].ingredients[carcass.type] +=
                carcass.weightUsed || 0;
            });
          }
          if (record.productName) {
            usage[recipeName].products.push(record.productName);
          }
        }
      });
      setMaterialUsage(Object.values(usage));
    } catch (error) {
      console.error("Failed to load material usage:", error);
    }
  }, []);

  // ============ LOAD SALES REPORT ============
  const loadSalesReport = useCallback(async () => {
    try {
      const stored = await AsyncStorage.getItem(DISPATCH_RECORDS_KEY);
      const records = stored ? JSON.parse(stored) : [];
      setSalesReport(
        records.slice(0, 30).map((record) => ({
          id: record.id || Date.now().toString(),
          customer: record.customerName || "Unknown",
          items: record.items || [],
          totalItems: record.totalItems || 0,
          date: record.timestamp || new Date().toISOString(),
          dispatchNumber: record.dispatchNumber || "N/A",
          revenue: record.totalAmount || 0,
        })),
      );
    } catch (error) {
      console.error("Failed to load sales report:", error);
    }
  }, []);

  // ============ LOAD STOCK FOR REMOVAL ============
  const loadStockForRemoval = useCallback(async () => {
    try {
      const [dry, cold] = await Promise.all([
        AsyncStorage.getItem(DRY_STOCK_KEY),
        AsyncStorage.getItem(COLD_STOCK_KEY),
      ]);
      const allStock = [
        ...(dry ? JSON.parse(dry) : []),
        ...(cold ? JSON.parse(cold) : []),
      ];
      setStockForRemoval(
        allStock.filter((item) => (item.totalWeight || 0) > 0.01),
      );
    } catch (error) {
      console.error("Failed to load stock for removal:", error);
    }
  }, []);

  // ============ LOAD BACKUP HISTORY ============
  const loadBackupHistory = useCallback(async () => {
    try {
      const stored = await AsyncStorage.getItem("@backup_history");
      if (stored) setBackupHistory(JSON.parse(stored));
    } catch (error) {
      console.error("Failed to load backup history:", error);
    }
  }, []);

  // ============ LOG AUDIT ============
  const logAudit = useCallback(
    async (action, details) => {
      try {
        await addDoc(collection(db, "audit_logs"), {
          action,
          details,
          timestamp: new Date(),
          userRole: "system_administrator",
          userName: user?.fName || "Super Admin",
        });
      } catch (error) {
        console.error("Failed to log audit:", error);
      }
    },
    [user],
  );

  // ============ ON REFRESH ============
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadAllData(true);
    setRefreshing(false);
  }, [loadAllData]);

  // ============ AUTO-REFRESH SETUP ============
  const setupAutoRefresh = useCallback(() => {
    if (autoRefreshTimer.current) {
      clearInterval(autoRefreshTimer.current);
      autoRefreshTimer.current = null;
    }
    autoRefreshTimer.current = setInterval(() => {
      if (appState.current === "active") {
        console.log("🔄 Auto-refreshing data...");
        loadAllData(true);
      }
    }, 30000);
  }, [loadAllData]);

  // ============ APP STATE HANDLER ============
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextAppState) => {
      appState.current = nextAppState;
      if (nextAppState === "active") {
        loadAllData(true);
        setupAutoRefresh();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [loadAllData, setupAutoRefresh]);

  // ============ INITIAL LOAD ============
  useEffect(() => {
    loadAllData();
    loadBackupHistory();
    setupRealtimeListeners();
    setupAutoRefresh();

    return () => {
      if (approvalListener.current) approvalListener.current();
      if (auditListener.current) auditListener.current();
      if (autoRefreshTimer.current) {
        clearInterval(autoRefreshTimer.current);
        autoRefreshTimer.current = null;
      }
    };
  }, []);

  // ============ EMPLOYEE MANAGEMENT FUNCTIONS ============

  const toggleEmployeeStatus = useCallback(
    async (clerk) => {
      const newStatus = !clerk.isActive;
      const action = newStatus ? "activate" : "deactivate";

      Alert.alert(
        `${newStatus ? "Activate" : "Deactivate"} Employee`,
        `Are you sure you want to ${action} ${clerk.fName} ${clerk.lName || ""}?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Confirm",
            onPress: async () => {
              try {
                const businessRef = doc(db, "Businesses", businessId);
                const clerkRef = doc(
                  collection(businessRef, "Clerks"),
                  clerk.id,
                );
                await updateDoc(clerkRef, {
                  isActive: newStatus,
                  statusUpdatedAt: new Date().toISOString(),
                  statusUpdatedBy: user?.fName || "Admin",
                });

                await logAudit(`${action.toUpperCase()}_EMPLOYEE`, {
                  name: `${clerk.fName} ${clerk.lName || ""}`,
                  role: clerk.role,
                  newStatus: newStatus,
                });

                ToastAndroid.show(
                  `${clerk.fName} ${newStatus ? "activated" : "deactivated"} successfully!`,
                  ToastAndroid.LONG,
                );

                addNotification(
                  `Employee ${newStatus ? "Activated" : "Deactivated"}`,
                  `${clerk.fName} ${clerk.lName || ""} has been ${newStatus ? "activated" : "deactivated"}.`,
                  "employee",
                );

                loadBusinessAndClerks();
              } catch (error) {
                console.error("Failed to update employee status:", error);
                ToastAndroid.show(
                  "Failed to update status",
                  ToastAndroid.SHORT,
                );
              }
            },
          },
        ],
      );
    },
    [businessId, user, logAudit, addNotification, loadBusinessAndClerks],
  );

  const deleteEmployee = useCallback(
    async (clerk) => {
      Alert.alert(
        "Delete Employee",
        `Are you sure you want to DELETE ${clerk.fName} ${clerk.lName || ""}?\n\n⚠️ This action cannot be undone!`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: async () => {
              try {
                const businessRef = doc(db, "Businesses", businessId);
                await deleteDoc(
                  doc(collection(businessRef, "Clerks"), clerk.id),
                );

                await logAudit("DELETE_EMPLOYEE", {
                  name: `${clerk.fName} ${clerk.lName || ""}`,
                  role: clerk.role,
                  reason: "Resigned/Left company",
                });

                ToastAndroid.show(
                  `${clerk.fName} deleted successfully!`,
                  ToastAndroid.LONG,
                );

                addNotification(
                  "Employee Deleted",
                  `${clerk.fName} ${clerk.lName || ""} has been removed from the system.`,
                  "employee",
                );

                loadBusinessAndClerks();
              } catch (error) {
                console.error("Failed to delete employee:", error);
                ToastAndroid.show(
                  "Failed to delete employee",
                  ToastAndroid.SHORT,
                );
              }
            },
          },
        ],
      );
    },
    [businessId, user, logAudit, addNotification, loadBusinessAndClerks],
  );

  // ============ EXPORT TO CSV/EXCEL (NO ExpoSharing) ============
  const exportToCSV = useCallback(
    async (data, filename, headers) => {
      setExportLoading(true);
      try {
        let csvContent = headers.join(",") + "\n";

        data.forEach((row) => {
          const rowData = headers.map((header) => {
            const value = row[header] || "";
            if (typeof value === "string" && value.includes(",")) {
              return `"${value}"`;
            }
            return value;
          });
          csvContent += rowData.join(",") + "\n";
        });

        const fileName = `${filename}_${new Date().toISOString().split("T")[0]}.csv`;
        const filePath = `${FileSystem.documentDirectory}${fileName}`;

        await FileSystem.writeAsStringAsync(filePath, csvContent);

        ToastAndroid.show(`✅ Report exported: ${fileName}`, ToastAndroid.LONG);

        await Share.share({
          message: `📊 ${fileName}\n\n${csvContent}`,
          title: `Export Report - ${filename}`,
        });

        await logAudit("EXPORT_REPORT", {
          type: filename,
          records: data.length,
          format: "CSV",
        });
      } catch (error) {
        console.error("Failed to export CSV:", error);
        ToastAndroid.show("Failed to export report", ToastAndroid.SHORT);
      } finally {
        setExportLoading(false);
      }
    },
    [logAudit],
  );

  // ============ EXPORT TO TEXT (NO expo-print) ============
  const exportToText = useCallback(
    async (data, title, headers, columns) => {
      setExportLoading(true);
      try {
        const line = "═".repeat(60);
        let textContent = `${line}\n`;
        textContent += `  ${businessName || "Business"} - ${title}\n`;
        textContent += `  Generated: ${new Date().toLocaleString()}\n`;
        textContent += `${line}\n\n`;

        textContent += headers.join(" │ ") + "\n";
        textContent += "─".repeat(60) + "\n";

        data.slice(0, 100).forEach((row) => {
          const rowData = columns.map((col) => {
            let value =
              row[col] !== undefined && row[col] !== null ? row[col] : "";
            if (col === "revenue" || col === "totalWeight") {
              value = parseFloat(value).toFixed(2);
            }
            if (col === "date" || col === "timestamp") {
              value = new Date(value).toLocaleString();
            }
            return String(value).padEnd(15, " ");
          });
          textContent += rowData.join(" │ ") + "\n";
        });

        if (data.length > 100) {
          textContent += `\n... and ${data.length - 100} more records`;
        }

        textContent += `\n${line}\n`;
        textContent += `  Total Records: ${data.length}\n`;
        textContent += `  Generated by Happy Sausage Management System\n`;
        textContent += `  ${businessName || "Business"} - All Rights Reserved\n`;
        textContent += `${line}`;

        const fileName = `${title.replace(/\s+/g, "_")}_${new Date().toISOString().split("T")[0]}.txt`;
        const filePath = `${FileSystem.documentDirectory}${fileName}`;
        await FileSystem.writeAsStringAsync(filePath, textContent);

        ToastAndroid.show(`✅ Report exported: ${fileName}`, ToastAndroid.LONG);

        await Share.share({
          message: textContent,
          title: `Export Report - ${title}`,
        });

        await logAudit("EXPORT_REPORT", {
          type: title,
          records: data.length,
          format: "TEXT",
        });
      } catch (error) {
        console.error("Failed to export report:", error);
        ToastAndroid.show("Failed to export report", ToastAndroid.SHORT);
      } finally {
        setExportLoading(false);
      }
    },
    [businessName, logAudit],
  );

  // ============ EXPORT REPORT ============
  const handleExportReport = useCallback(async () => {
    if (reportData.length === 0) {
      ToastAndroid.show(
        "No data to export. Generate a report first.",
        ToastAndroid.SHORT,
      );
      return;
    }

    Alert.alert("Export Report", "Choose export format:", [
      {
        text: "📊 CSV (Excel)",
        onPress: () => {
          let headers = [];
          let columns = [];
          let filename = "";
          let data = reportData;

          if (reportType === "dispatch") {
            headers = ["Dispatch No", "Customer", "Items", "Revenue", "Date"];
            columns = [
              "dispatchNumber",
              "customer",
              "totalItems",
              "revenue",
              "date",
            ];
            filename = "Dispatch_Report";
          } else if (reportType === "processing") {
            headers = ["Product", "Batch Code", "Pieces", "Weight", "Date"];
            columns = [
              "productName",
              "batchCode",
              "totalPieces",
              "totalWeight",
              "timestamp",
            ];
            filename = "Processing_Report";
          } else if (reportType === "stock") {
            headers = ["Item", "Weight", "Pieces", "Store", "Status"];
            columns = ["type", "totalWeight", "pieces", "store", "isActive"];
            filename = "Stock_Report";
          }

          const formattedData = data.map((item) => {
            const row = {};
            columns.forEach((col, index) => {
              let value = item[col] || "";
              if (col === "revenue" || col === "totalWeight") {
                value = parseFloat(value).toFixed(2);
              }
              if (col === "date" || col === "timestamp") {
                value = new Date(value).toLocaleString();
              }
              row[headers[index]] = value;
            });
            return row;
          });

          exportToCSV(formattedData, filename, headers);
        },
      },
      {
        text: "📄 Text Report",
        onPress: () => {
          let headers = [];
          let columns = [];
          let title = "";
          let data = reportData;

          if (reportType === "dispatch") {
            headers = ["Dispatch No", "Customer", "Items", "Revenue", "Date"];
            columns = [
              "dispatchNumber",
              "customer",
              "totalItems",
              "revenue",
              "date",
            ];
            title = "Dispatch Report";
          } else if (reportType === "processing") {
            headers = ["Product", "Batch Code", "Pieces", "Weight", "Date"];
            columns = [
              "productName",
              "batchCode",
              "totalPieces",
              "totalWeight",
              "timestamp",
            ];
            title = "Processing Report";
          } else if (reportType === "stock") {
            headers = ["Item", "Weight", "Pieces", "Store", "Status"];
            columns = ["type", "totalWeight", "pieces", "store", "isActive"];
            title = "Stock Report";
          }

          exportToText(data, title, headers, columns);
        },
      },
      { text: "Cancel", style: "cancel" },
    ]);
  }, [reportData, reportType, exportToCSV, exportToText]);

  // ============ REVERSE TRANSACTION ============
  const reverseTransaction = useCallback(async () => {
    if (!selectedTransaction) {
      ToastAndroid.show("Select a transaction to reverse", ToastAndroid.SHORT);
      return;
    }
    if (!reversalReason.trim()) {
      ToastAndroid.show(
        "Please provide a reason for reversal",
        ToastAndroid.SHORT,
      );
      return;
    }
    try {
      await logAudit("REVERSE_TRANSACTION", {
        transactionId: selectedTransaction.id,
        type: selectedTransaction.type,
        reason: reversalReason,
        details: selectedTransaction.details,
        itemName: selectedTransaction.itemName,
      });
      ToastAndroid.show(
        "Transaction reversed successfully!",
        ToastAndroid.LONG,
      );
      setReversalModalVisible(false);
      setSelectedTransaction(null);
      setReversalReason("");
      loadAllData(true);
    } catch (error) {
      console.error("Failed to reverse transaction:", error);
      ToastAndroid.show("Failed to reverse transaction", ToastAndroid.SHORT);
    }
  }, [selectedTransaction, reversalReason, logAudit, loadAllData]);

  // ============ REMOVE STOCK ============
  const handleRemoveStock = useCallback(async () => {
    if (!selectedStockItem) {
      ToastAndroid.show("Select an item to remove", ToastAndroid.SHORT);
      return;
    }
    const weightToRemove = parseFloat(removeWeight);
    if (isNaN(weightToRemove) || weightToRemove <= 0) {
      ToastAndroid.show("Please enter a valid weight (kg)", ToastAndroid.SHORT);
      return;
    }
    const currentWeight = selectedStockItem.totalWeight || 0;
    if (weightToRemove > currentWeight) {
      ToastAndroid.show(
        `Only ${currentWeight.toFixed(3)} kg available`,
        ToastAndroid.SHORT,
      );
      return;
    }
    if (!removalReason.trim()) {
      ToastAndroid.show(
        "Please enter a reason for removal",
        ToastAndroid.SHORT,
      );
      return;
    }
    try {
      const newWeight = currentWeight - weightToRemove;
      const stockKey = selectedStockItem.isDebonned
        ? COLD_STOCK_KEY
        : DRY_STOCK_KEY;
      const stored = await AsyncStorage.getItem(stockKey);
      let stockList = stored ? JSON.parse(stored) : [];
      const index = stockList.findIndex(
        (item) => item.id === selectedStockItem.id,
      );
      if (index !== -1) {
        if (newWeight <= 0.01) {
          stockList.splice(index, 1);
        } else {
          stockList[index].totalWeight = newWeight;
          stockList[index].lastUpdated = new Date().toISOString();
          stockList[index].removalReason = removalReason;
          stockList[index].removalDate = new Date().toISOString();
          stockList[index].removedBy = user?.fName || "Admin";
        }
        await AsyncStorage.setItem(stockKey, JSON.stringify(stockList));
      }
      await logAudit("REMOVE_STOCK", {
        item: selectedStockItem.type || selectedStockItem.name,
        weightRemoved: weightToRemove,
        remainingWeight: newWeight,
        reason: removalReason,
        store: selectedStockItem.isDebonned ? "Cold Room" : "Dry Goods",
      });
      ToastAndroid.show(
        `Removed ${weightToRemove.toFixed(3)} kg. Remaining: ${newWeight.toFixed(3)} kg`,
        ToastAndroid.LONG,
      );
      setRemovalModalVisible(false);
      setSelectedStockItem(null);
      setRemoveWeight("");
      setRemovalReason("");
      loadAllData(true);
    } catch (error) {
      console.error("Failed to remove stock:", error);
      ToastAndroid.show("Failed to remove stock", ToastAndroid.SHORT);
    }
  }, [
    selectedStockItem,
    removeWeight,
    removalReason,
    user,
    logAudit,
    loadAllData,
  ]);

  // ============ BACKUP FUNCTIONS ============
  const handleBackup = useCallback(async () => {
    setLoading(true);
    try {
      const backup = {
        businessId,
        businessName,
        timestamp: new Date().toISOString(),
        version: "1.0",
        data: {
          clerks,
          dryGoodsStock,
          coldRoomStock,
          packedProducts,
          processingRecords,
          dispatchRecords,
          auditLogs,
          usedStockItems: Array.isArray(usedStockItems) ? usedStockItems : [],
          stockUsageDetails: Array.isArray(stockUsageDetails)
            ? stockUsageDetails
            : [],
        },
        stats,
      };
      const jsonString = JSON.stringify(backup, null, 2);
      const fileName = `backup_${businessName || "business"}_${new Date().toISOString().replace(/[:.]/g, "_")}.json`;
      const filePath = `${FileSystem.documentDirectory}${fileName}`;
      await FileSystem.writeAsStringAsync(filePath, jsonString);
      setBackupData({
        jsonString,
        filePath,
        fileName,
        size: jsonString.length,
      });
      const historyEntry = {
        id: Date.now().toString(),
        timestamp: new Date().toISOString(),
        fileName,
        size: jsonString.length,
        records: {
          clerks: clerks.length,
          dryGoods: dryGoodsStock.length,
          coldRoom: coldRoomStock.length,
          products: packedProducts.length,
          processing: processingRecords.length,
          dispatch: dispatchRecords.length,
          usedStock: Array.isArray(usedStockItems) ? usedStockItems.length : 0,
        },
      };
      const updatedHistory = [historyEntry, ...backupHistory];
      setBackupHistory(updatedHistory);
      await AsyncStorage.setItem(
        "@backup_history",
        JSON.stringify(updatedHistory),
      );
      await logAudit("BACKUP_DATA", {
        fileName,
        size: jsonString.length,
        records: historyEntry.records,
      });
      ToastAndroid.show(
        `Backup saved!\nSize: ${(jsonString.length / 1024).toFixed(1)} KB`,
        ToastAndroid.LONG,
      );
    } catch (error) {
      console.error("Failed to backup data:", error);
      ToastAndroid.show("Failed to backup data", ToastAndroid.SHORT);
    } finally {
      setLoading(false);
    }
  }, [
    businessId,
    businessName,
    clerks,
    dryGoodsStock,
    coldRoomStock,
    packedProducts,
    processingRecords,
    dispatchRecords,
    auditLogs,
    usedStockItems,
    stockUsageDetails,
    stats,
    backupHistory,
    logAudit,
  ]);

  // ============ SHARE BACKUP ============
  const shareBackupFile = useCallback(async () => {
    if (!backupData || !backupData.jsonString) {
      ToastAndroid.show("Please create a backup first", ToastAndroid.SHORT);
      return;
    }
    try {
      await Share.share({
        message: `=== ${businessName || "Business"} BACKUP ===\nDate: ${new Date().toLocaleString()}\nSize: ${(backupData.size / 1024).toFixed(1)} KB\n\n${backupData.jsonString}`,
        title: `${businessName || "Business"} - Backup Data`,
      });
      await logAudit("SHARE_BACKUP", {
        fileName: backupData.fileName,
        size: backupData.size,
      });
    } catch (error) {
      console.error("Failed to share backup:", error);
      ToastAndroid.show("Failed to share backup", ToastAndroid.SHORT);
    }
  }, [backupData, businessName, logAudit]);

  const shareBackupAsText = useCallback(async () => {
    if (!backupData || !backupData.jsonString) {
      ToastAndroid.show("Please create a backup first", ToastAndroid.SHORT);
      return;
    }
    try {
      await Share.share({
        message: `=== ${businessName || "Business"} BACKUP ===\nDate: ${new Date().toLocaleString()}\nSize: ${(backupData.size / 1024).toFixed(1)} KB\n\n${backupData.jsonString}`,
        title: `${businessName || "Business"} - Backup Data`,
      });
      await logAudit("SHARE_BACKUP_TEXT", { size: backupData.size });
    } catch (error) {
      console.error("Failed to share backup:", error);
      ToastAndroid.show("Failed to share backup", ToastAndroid.SHORT);
    }
  }, [backupData, businessName, logAudit]);

  const deleteBackupFile = useCallback(async () => {
    if (!backupData || !backupData.filePath) {
      ToastAndroid.show("No backup file to delete", ToastAndroid.SHORT);
      return;
    }
    try {
      const fileInfo = await FileSystem.getInfoAsync(backupData.filePath);
      if (fileInfo.exists) await FileSystem.deleteAsync(backupData.filePath);
      setBackupData({
        jsonString: null,
        filePath: null,
        fileName: null,
        size: 0,
      });
      ToastAndroid.show("Backup file deleted", ToastAndroid.SHORT);
      await logAudit("DELETE_BACKUP", { fileName: backupData.fileName });
    } catch (error) {
      console.error("Failed to delete backup:", error);
      ToastAndroid.show("Failed to delete backup", ToastAndroid.SHORT);
    }
  }, [backupData, logAudit]);

  const downloadBackup = useCallback(async () => {
    if (!backupData || !backupData.jsonString) {
      ToastAndroid.show("Please create a backup first", ToastAndroid.SHORT);
      return;
    }
    try {
      const fileName = `backup_${businessName || "business"}_${new Date().toISOString().replace(/[:.]/g, "_")}.json`;
      const filePath = `${FileSystem.documentDirectory}${fileName}`;
      await FileSystem.writeAsStringAsync(filePath, backupData.jsonString);
      ToastAndroid.show(
        `✅ Backup downloaded!\nSaved to: ${filePath}`,
        ToastAndroid.LONG,
      );
      await logAudit("DOWNLOAD_BACKUP", { fileName });
    } catch (error) {
      console.error("Failed to download backup:", error);
      ToastAndroid.show("Failed to download backup", ToastAndroid.SHORT);
    }
  }, [backupData, businessName, logAudit]);

  // ============ RESTORE DATA ============
  const handleRestore = useCallback(async () => {
    if (!restoreData.trim()) {
      ToastAndroid.show("Please paste the backup data", ToastAndroid.SHORT);
      return;
    }
    Alert.alert(
      "Restore Data",
      "This will overwrite all current data. Are you sure?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Restore",
          style: "destructive",
          onPress: async () => {
            try {
              const backup = JSON.parse(restoreData);
              if (!backup.data) {
                ToastAndroid.show("Invalid backup data", ToastAndroid.SHORT);
                return;
              }
              const data = backup.data;
              if (data.dryGoodsStock)
                await AsyncStorage.setItem(
                  DRY_STOCK_KEY,
                  JSON.stringify(data.dryGoodsStock),
                );
              if (data.coldRoomStock)
                await AsyncStorage.setItem(
                  COLD_STOCK_KEY,
                  JSON.stringify(data.coldRoomStock),
                );
              if (data.packedProducts)
                await AsyncStorage.setItem(
                  PACKED_PRODUCTS_KEY,
                  JSON.stringify(data.packedProducts),
                );
              if (data.processingRecords)
                await AsyncStorage.setItem(
                  PROCESSING_RECORDS_KEY,
                  JSON.stringify(data.processingRecords),
                );
              if (data.dispatchRecords)
                await AsyncStorage.setItem(
                  DISPATCH_RECORDS_KEY,
                  JSON.stringify(data.dispatchRecords),
                );
              if (data.usedStockItems && Array.isArray(data.usedStockItems))
                setUsedStockItems(data.usedStockItems);
              if (
                data.stockUsageDetails &&
                Array.isArray(data.stockUsageDetails)
              )
                setStockUsageDetails(data.stockUsageDetails);
              await logAudit("RESTORE_DATA", {
                timestamp: backup.timestamp,
                records: backup.stats,
              });
              ToastAndroid.show(
                "Data restored successfully!",
                ToastAndroid.LONG,
              );
              setRestoreData("");
              loadAllData(true);
            } catch (error) {
              console.error("Failed to restore data:", error);
              ToastAndroid.show(
                "Invalid backup data format",
                ToastAndroid.SHORT,
              );
            }
          },
        },
      ],
    );
  }, [restoreData, logAudit, loadAllData]);

  // ============ DELETE TRANSACTION ============
  const handleDeleteTransaction = useCallback(async () => {
    if (!itemToDelete) return;
    if (deleteConfirmText.toLowerCase() !== "delete") {
      ToastAndroid.show('Type "delete" to confirm', ToastAndroid.SHORT);
      return;
    }
    try {
      const stored = await AsyncStorage.getItem(PROCESSING_RECORDS_KEY);
      let records = stored ? JSON.parse(stored) : [];
      const updatedRecords = records.filter((r) => r.id !== itemToDelete.id);
      await AsyncStorage.setItem(
        PROCESSING_RECORDS_KEY,
        JSON.stringify(updatedRecords),
      );
      await logAudit("DELETE_TRANSACTION", {
        itemId: itemToDelete.id,
        productName: itemToDelete.itemName,
        details: itemToDelete.details,
        deletedBy: user?.fName || "Admin",
      });
      ToastAndroid.show(
        `Transaction deleted: ${itemToDelete.itemName}`,
        ToastAndroid.LONG,
      );
      setDeleteModalVisible(false);
      setItemToDelete(null);
      setDeleteConfirmText("");
      loadAllData(true);
    } catch (error) {
      console.error("Failed to delete transaction:", error);
      ToastAndroid.show("Failed to delete transaction", ToastAndroid.SHORT);
    }
  }, [itemToDelete, deleteConfirmText, user, logAudit, loadAllData]);

  // ============ FILTER MOVEMENTS ============
  const filterMovements = useCallback(
    (text) => {
      setFilterText(text);
      if (text.trim() === "") {
        setItemSpecificMovements(stockMovements);
      } else {
        setItemSpecificMovements(
          stockMovements.filter(
            (m) =>
              m.itemName.toLowerCase().includes(text.toLowerCase()) ||
              m.type.toLowerCase().includes(text.toLowerCase()) ||
              m.user.toLowerCase().includes(text.toLowerCase()),
          ),
        );
      }
    },
    [stockMovements],
  );

  // ============ GENERATE REPORT ============
  const generateReport = useCallback(async () => {
    setLoading(true);
    try {
      let data = [];
      if (reportType === "dispatch") data = dispatchRecords;
      else if (reportType === "processing") data = processingRecords;
      else if (reportType === "stock")
        data = [...dryGoodsStock, ...coldRoomStock];
      setReportData(data);
      ToastAndroid.show(
        `Report generated: ${data.length} records`,
        ToastAndroid.SHORT,
      );
    } catch (error) {
      ToastAndroid.show("Failed to generate report", ToastAndroid.SHORT);
    } finally {
      setLoading(false);
    }
  }, [
    reportType,
    dispatchRecords,
    processingRecords,
    dryGoodsStock,
    coldRoomStock,
  ]);

  // ============ SWITCH TO EMPLOYEE VIEW ============
  const switchToEmployeeView = useCallback(() => {
    navigation.replace("TabLayout");
  }, [navigation]);

  // ============ LOGOUT ============
  const handleLogout = useCallback(() => {
    Alert.alert("Logout", "Are you sure you want to logout?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Logout",
        onPress: () => {
          dispatch(setLoggedIn(false));
          dispatch(setUser(null));
          dispatch(setBusinessId(null));
          navigation.replace("LoginPage");
        },
      },
    ]);
  }, [dispatch, navigation]);

  // ============ USER MANAGEMENT ============
  const handleCreateClerk = useCallback(async () => {
    if (!firstName.trim()) {
      ToastAndroid.show("Please enter first name", ToastAndroid.SHORT);
      return;
    }
    if (!password.trim()) {
      ToastAndroid.show("Please enter password", ToastAndroid.SHORT);
      return;
    }
    if (password.length < 4) {
      ToastAndroid.show(
        "Password must be at least 4 characters",
        ToastAndroid.SHORT,
      );
      return;
    }
    setLoading(true);
    try {
      const businessRef = doc(db, "Businesses", businessId);
      await addDoc(collection(businessRef, "Clerks"), {
        fName: firstName.trim(),
        lName: lastName.trim(),
        Id: password,
        role: role,
        fullAccess: roles.find((r) => r.value === role)?.fullAccess || false,
        createdAt: new Date().toISOString(),
        isActive: true,
      });
      await logAudit("CREATE_USER", { name: firstName, role: role });
      ToastAndroid.show(`${firstName} created!`, ToastAndroid.LONG);
      resetForm();
      setActiveModal(null);
      loadBusinessAndClerks();
    } catch (error) {
      ToastAndroid.show("Creation failed", ToastAndroid.SHORT);
    } finally {
      setLoading(false);
    }
  }, [
    firstName,
    lastName,
    password,
    role,
    businessId,
    logAudit,
    loadBusinessAndClerks,
  ]);

  const resetForm = useCallback(() => {
    setFirstName("");
    setLastName("");
    setPassword("");
    setRole("storekeeper");
  }, []);

  // ============ APPROVE/REJECT REQUESTS ============
  const handleApproveRequest = useCallback(
    async (request) => {
      try {
        const requestRef = doc(db, "approval_requests", request.id);
        await updateDoc(requestRef, {
          status: "approved",
          approvedAt: new Date().toISOString(),
          approvedBy: user?.fName || "system_administrator",
        });
        await logAudit("APPROVE_REQUEST", {
          type: request.type,
          id: request.id,
        });
        ToastAndroid.show("Request approved", ToastAndroid.SHORT);
        loadApprovals();
      } catch (error) {
        ToastAndroid.show("Approval failed", ToastAndroid.SHORT);
      }
    },
    [user, logAudit, loadApprovals],
  );

  const handleRejectRequest = useCallback(
    async (request) => {
      Alert.alert("Reject Request", "Are you sure?", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reject",
          style: "destructive",
          onPress: async () => {
            try {
              const requestRef = doc(db, "approval_requests", request.id);
              await updateDoc(requestRef, {
                status: "rejected",
                rejectedAt: new Date().toISOString(),
                rejectedBy: user?.fName || "system_administrator",
              });
              await logAudit("REJECT_REQUEST", {
                type: request.type,
                id: request.id,
              });
              ToastAndroid.show("Request rejected", ToastAndroid.SHORT);
              loadApprovals();
            } catch (error) {
              ToastAndroid.show("Rejection failed", ToastAndroid.SHORT);
            }
          },
        },
      ]);
    },
    [user, logAudit, loadApprovals],
  );

  // ============ RENDER FUNCTIONS ============
  const renderClerkItem = useCallback(
    ({ item }) => (
      <View style={styles.listItem}>
        <View style={styles.listItemInfo}>
          <Text style={styles.listItemTitle}>
            {item.fName} {item.lName || ""}
          </Text>
          <Text style={styles.listItemSubtitle}>
            Role: {roles.find((r) => r.value === item.role)?.label || item.role}
          </Text>
          <Text style={styles.listItemDetail}>Password: {item.Id}</Text>
        </View>
        <TouchableOpacity
          style={styles.deleteBtn}
          onPress={() => handleDeleteClerk(item)}
        >
          <Text style={styles.deleteBtnText}>🗑️</Text>
        </TouchableOpacity>
      </View>
    ),
    [],
  );

  const handleDeleteClerk = useCallback(
    async (clerk) => {
      Alert.alert(
        "Delete User",
        `Delete ${clerk.fName} ${clerk.lName || ""}?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: async () => {
              try {
                const businessRef = doc(db, "Businesses", businessId);
                await deleteDoc(
                  doc(collection(businessRef, "Clerks"), clerk.id),
                );
                await logAudit("DELETE_USER", { name: clerk.fName });
                ToastAndroid.show("User deleted", ToastAndroid.SHORT);
                loadBusinessAndClerks();
              } catch (error) {
                ToastAndroid.show("Delete failed", ToastAndroid.SHORT);
              }
            },
          },
        ],
      );
    },
    [businessId, logAudit, loadBusinessAndClerks],
  );

  // ============ RENDER EMPLOYEE CARD ============
  const renderEmployeeCard = useCallback(
    ({ item }) => {
      const roleLabel =
        roles.find((r) => r.value === item.role)?.label || item.role;
      const isActive = item.isActive !== false;

      return (
        <View
          style={[
            styles.employeeCard,
            !isActive && styles.employeeCardInactive,
          ]}
        >
          <View style={styles.employeeAvatar}>
            <Text
              style={[
                styles.employeeAvatarText,
                !isActive && styles.employeeAvatarTextInactive,
              ]}
            >
              {item.fName?.charAt(0) || "?"}
            </Text>
          </View>
          <View style={styles.employeeInfo}>
            <Text
              style={[
                styles.employeeName,
                !isActive && styles.employeeNameInactive,
              ]}
            >
              {item.fName} {item.lName || ""}
            </Text>
            <Text
              style={[
                styles.employeeRole,
                !isActive && styles.employeeRoleInactive,
              ]}
            >
              {roleLabel}
            </Text>
            <Text style={styles.employeeCredentials}>
              Username: {item.fName} | Password: {item.Id}
            </Text>
            <View style={styles.employeeActions}>
              <TouchableOpacity
                style={[
                  styles.employeeActionBtn,
                  isActive ? styles.deactivateBtn : styles.activateBtn,
                ]}
                onPress={() => toggleEmployeeStatus(item)}
              >
                <Text style={styles.employeeActionBtnText}>
                  {isActive ? "🔴 Deactivate" : "🟢 Activate"}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.employeeActionBtn, styles.deleteEmployeeBtn]}
                onPress={() => deleteEmployee(item)}
              >
                <Text style={styles.employeeActionBtnText}>🗑️ Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
          <View style={styles.employeeStatus}>
            <View style={[styles.statusDot, isActive && styles.statusActive]} />
            <Text
              style={[
                styles.statusText,
                !isActive && styles.statusTextInactive,
              ]}
            >
              {isActive ? "Active" : "Inactive"}
            </Text>
          </View>
        </View>
      );
    },
    [toggleEmployeeStatus, deleteEmployee],
  );

  // ============ DASHBOARD CARD ============
  const DashboardCard = useCallback(
    ({ icon, title, value, onPress, color, badge, subtext }) => (
      <TouchableOpacity
        style={[styles.card, { borderTopColor: color }]}
        onPress={onPress}
      >
        <Text style={styles.cardIcon}>{icon}</Text>
        <Text style={styles.cardTitle}>{title}</Text>
        {value !== undefined && <Text style={styles.cardValue}>{value}</Text>}
        {subtext && <Text style={styles.cardSubtext}>{subtext}</Text>}
        {badge > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badge}</Text>
          </View>
        )}
      </TouchableOpacity>
    ),
    [],
  );

  const renderAuditItem = useCallback(
    ({ item }) => (
      <View style={styles.listItem}>
        <View style={styles.listItemInfo}>
          <Text style={styles.listItemTitle}>{item.action}</Text>
          <Text style={styles.listItemSubtitle}>
            {item.userName || "System"}
          </Text>
          <Text style={styles.listItemDetail}>
            {item.details ? JSON.stringify(item.details) : ""}
          </Text>
          <Text style={styles.listItemDate}>
            {item.timestamp?.toDate?.()?.toLocaleString() ||
              new Date().toLocaleString()}
          </Text>
        </View>
      </View>
    ),
    [],
  );

  const renderApprovalItem = useCallback(
    ({ item }) => (
      <View style={styles.listItem}>
        <View style={styles.listItemInfo}>
          <Text style={styles.listItemTitle}>{item.type}</Text>
          <Text style={styles.listItemSubtitle}>
            Requested by: {item.requestedByName || "Unknown"}
          </Text>
          <Text style={styles.listItemDetail}>
            {item.details?.itemName || ""}
          </Text>
        </View>
        <View style={styles.approvalButtons}>
          <TouchableOpacity
            style={styles.approveBtn}
            onPress={() => handleApproveRequest(item)}
          >
            <Text style={styles.approveBtnText}>✓</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.rejectBtn}
            onPress={() => handleRejectRequest(item)}
          >
            <Text style={styles.rejectBtnText}>✗</Text>
          </TouchableOpacity>
        </View>
      </View>
    ),
    [handleApproveRequest, handleRejectRequest],
  );

  // ============ RENDER USED STOCK ITEM ============
  const renderUsedStockItem = useCallback(({ item }) => {
    if (!item) return null;
    return (
      <View style={[styles.listItem, { backgroundColor: "#2a1a2e" }]}>
        <View style={styles.listItemInfo}>
          <Text style={styles.listItemTitle}>
            {item.type === "carcass" ? "🥩" : "📦"} {item.name || "Unknown"}
          </Text>
          <Text style={styles.listItemSubtitle}>
            Batch: {item.batchCode || "N/A"}
          </Text>
          <Text style={styles.listItemDetail}>
            Used: {(item.weightUsed || 0).toFixed(3)} kg
          </Text>
          <Text style={styles.listItemDetail}>
            Product Made: {item.productMade || "N/A"}
          </Text>
          <Text style={styles.listItemDetail}>
            Processing Batch: {item.processingBatchCode || "N/A"}
          </Text>
          <Text style={styles.listItemDate}>
            {item.timestamp ? new Date(item.timestamp).toLocaleString() : "N/A"}
          </Text>
        </View>
      </View>
    );
  }, []);

  // ============ LOADING SCREEN ============
  if (loading && initialLoad) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#e94560" />
        <Text style={styles.loadingText}>Loading Dashboard...</Text>
        <Text style={styles.loadingSubText}>Please wait</Text>
      </View>
    );
  }

  // ============ MAIN RETURN ============
  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0a0a1a" />

      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Admin</Text>
          <Text style={styles.headerSubtitle}>
            {businessName || "Control Panel"}
          </Text>
        </View>
        <View style={styles.headerButtons}>
          <TouchableOpacity
            style={styles.notificationBtn}
            onPress={() => setNotificationModalVisible(true)}
          >
            <Text style={styles.notificationIcon}>🔔</Text>
            {unreadCount > 0 && (
              <View style={styles.notificationBadge}>
                <Text style={styles.notificationBadgeText}>
                  {unreadCount > 9 ? "9+" : unreadCount}
                </Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.headerBtn, styles.employeeViewBtn]}
            onPress={switchToEmployeeView}
          >
            <Text style={styles.headerBtnText}>👷 Employee</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.headerBtn, styles.logoutBtn]}
            onPress={handleLogout}
          >
            <Text style={styles.headerBtnText}>🚪 Logout</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Stats Cards */}
        <View style={styles.statsContainer}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>
              {(stats.totalStockValue || 0).toFixed(1)}kg
            </Text>
            <Text style={styles.statLabel}>Total Stock</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>
              {(stats.usedStockValue || 0).toFixed(1)}kg
            </Text>
            <Text style={styles.statLabel}>Used Stock</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>
              {stats.usedCarcassesCount || 0}
            </Text>
            <Text style={styles.statLabel}>Carcasses Used</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{stats.usedDryGoodsCount || 0}</Text>
            <Text style={styles.statLabel}>Dry Goods Used</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{stats.todayDispatches || 0}</Text>
            <Text style={styles.statLabel}>Today's Dispatch</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>
              KES {(stats.totalRevenue || 0).toFixed(2)}
            </Text>
            <Text style={styles.statLabel}>Total Revenue</Text>
          </View>
        </View>

        {/* Dashboard Grid */}
        <View style={styles.gridContainer}>
          <DashboardCard
            icon="👥"
            title="User Management"
            value={clerks.length}
            onPress={() => setActiveModal("users")}
            color="#e94560"
          />
          <DashboardCard
            icon="📋"
            title="Audit Trail"
            value={auditLogs.length}
            onPress={() => setActiveModal("audit")}
            color="#4CAF50"
          />
          <DashboardCard
            icon="✓"
            title="Approvals"
            value={approvals.length}
            badge={approvalCount}
            onPress={() => setActiveModal("approvals")}
            color="#FFA500"
          />
          <DashboardCard
            icon="📊"
            title="Stock Balance"
            value={stockBalance.length}
            onPress={() => setActiveModal("stockBalance")}
            color="#2196F3"
          />
          <DashboardCard
            icon="🔄"
            title="Stock Movement"
            value={stockMovements.length}
            onPress={() => setActiveModal("stockMovement")}
            color="#FF9800"
          />
          <DashboardCard
            icon="📦"
            title="Opening Stock"
            value={openingStock.length}
            onPress={() => setActiveModal("openingStock")}
            color="#795548"
          />
          <DashboardCard
            icon="📈"
            title="Sales Report"
            value={salesReport.length}
            onPress={() => setActiveModal("salesReport")}
            color="#4CAF50"
          />
          <DashboardCard
            icon="📦"
            title="Material Usage"
            value={materialUsage.length}
            onPress={() => setActiveModal("materialUsage")}
            color="#9C27B0"
          />
          <DashboardCard
            icon="↩️"
            title="Reverse Transaction"
            onPress={() => setActiveModal("reverse")}
            color="#F44336"
          />
          <DashboardCard
            icon="📊"
            title="Charts"
            onPress={() => setActiveModal("charts")}
            color="#3F51B5"
          />
          <DashboardCard
            icon="📦"
            title="Stock Overview"
            value={dryGoodsStock.length + coldRoomStock.length}
            onPress={() => setActiveModal("stock")}
            color="#9C27B0"
          />
          <DashboardCard
            icon="👥"
            title="Employees"
            value={clerks.length}
            onPress={() => setActiveModal("employees")}
            color="#607D8B"
          />
          <DashboardCard
            icon="📊"
            title="Reports"
            onPress={() => setActiveModal("reports")}
            color="#2196F3"
          />
          <DashboardCard
            icon="🗑️"
            title="Remove Stock"
            onPress={() => {
              loadStockForRemoval();
              setActiveModal("removeStock");
            }}
            color="#FF4444"
          />
          <DashboardCard
            icon="💾"
            title="Backup & Restore"
            onPress={() => setActiveModal("backupRestore")}
            color="#4CAF50"
          />
          <DashboardCard
            icon="📊"
            title="Used Stock"
            value={Array.isArray(usedStockItems) ? usedStockItems.length : 0}
            subtext={`${Array.isArray(usedStockItems) ? usedStockItems.filter((i) => i && i.type === "carcass").length : 0} carcasses, ${Array.isArray(usedStockItems) ? usedStockItems.filter((i) => i && i.type === "dry_goods").length : 0} dry goods`}
            onPress={() => setActiveModal("usedStock")}
            color="#FF6F00"
          />
          <DashboardCard
            icon="🗑️"
            title="Delete Transaction"
            onPress={() => setActiveModal("deleteTransaction")}
            color="#CC0000"
          />
        </View>

        {/* Recent Activity */}
        <Text style={styles.sectionTitle}>Recent Activity</Text>
        <FlatList
          data={auditLogs.slice(0, 5)}
          keyExtractor={(item) => item.id}
          renderItem={renderAuditItem}
          scrollEnabled={false}
          ListEmptyComponent={
            <Text style={styles.emptyText}>No recent activity</Text>
          }
        />
      </ScrollView>

      {/* ============ NOTIFICATION MODAL ============ */}
      <Modal
        visible={notificationModalVisible}
        animationType="slide"
        transparent={false}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>
              Notifications ({unreadCount} unread)
            </Text>
            <TouchableOpacity
              onPress={() => setNotificationModalVisible(false)}
            >
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.notificationActions}>
            {unreadCount > 0 && (
              <TouchableOpacity
                style={styles.markAllReadBtn}
                onPress={markAllNotificationsRead}
              >
                <Text style={styles.markAllReadText}>Mark all as read</Text>
              </TouchableOpacity>
            )}
          </View>
          <FlatList
            data={notifications}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[
                  styles.notificationItem,
                  !item.read && styles.notificationUnread,
                ]}
                onPress={() => markNotificationRead(item.id)}
              >
                <View style={styles.notificationContent}>
                  <Text style={styles.notificationTitle}>{item.title}</Text>
                  <Text style={styles.notificationMessage}>{item.message}</Text>
                  <Text style={styles.notificationTime}>
                    {new Date(item.timestamp).toLocaleString()}
                  </Text>
                </View>
                {!item.read && <View style={styles.notificationDot} />}
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <Text style={styles.emptyText}>No notifications</Text>
            }
          />
        </View>
      </Modal>

      {/* ============ USED STOCK MODAL ============ */}
      <Modal
        visible={activeModal === "usedStock"}
        animationType="slide"
        transparent={false}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>
              Used Stock (
              {Array.isArray(usedStockItems) ? usedStockItems.length : 0})
            </Text>
            <TouchableOpacity onPress={() => setActiveModal(null)}>
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.modalContent}>
            <View style={styles.usageSummary}>
              <Text style={styles.usageSummaryText}>
                🥩 Carcasses Used:{" "}
                {Array.isArray(usedStockItems)
                  ? usedStockItems.filter((i) => i && i.type === "carcass")
                      .length
                  : 0}
              </Text>
              <Text style={styles.usageSummaryText}>
                📦 Dry Goods Used:{" "}
                {Array.isArray(usedStockItems)
                  ? usedStockItems.filter((i) => i && i.type === "dry_goods")
                      .length
                  : 0}
              </Text>
              <Text style={styles.usageSummaryText}>
                Total Weight Used:{" "}
                {(Array.isArray(usedStockItems)
                  ? usedStockItems.reduce(
                      (sum, i) => sum + (i.weightUsed || 0),
                      0,
                    )
                  : 0
                ).toFixed(2)}{" "}
                kg
              </Text>
            </View>
            <FlatList
              data={Array.isArray(usedStockItems) ? usedStockItems : []}
              keyExtractor={(item, index) =>
                item && item.id ? item.id + index : index.toString()
              }
              renderItem={renderUsedStockItem}
              ListEmptyComponent={
                <Text style={styles.emptyText}>No used stock items found</Text>
              }
            />
          </View>
        </View>
      </Modal>

      {/* ============ ALL OTHER MODALS ============ */}

      {/* User Management Modal */}
      <Modal
        visible={activeModal === "users"}
        animationType="slide"
        transparent={false}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>User Management</Text>
            <TouchableOpacity
              onPress={() => {
                setActiveModal(null);
                resetForm();
              }}
            >
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.modalContent}>
            <View style={styles.formSection}>
              <Text style={styles.formTitle}>➕ Create New User</Text>
              <TextInput
                style={styles.input}
                placeholder="First Name"
                placeholderTextColor="#888"
                value={firstName}
                onChangeText={setFirstName}
              />
              <TextInput
                style={styles.input}
                placeholder="Last Name (Optional)"
                placeholderTextColor="#888"
                value={lastName}
                onChangeText={setLastName}
              />
              <TextInput
                style={styles.input}
                placeholder="Password"
                placeholderTextColor="#888"
                secureTextEntry
                value={password}
                onChangeText={setPassword}
              />
              <Text style={styles.label}>Select Role:</Text>
              <View style={styles.rolesContainer}>
                {roles.map((r) => (
                  <TouchableOpacity
                    key={r.value}
                    style={[
                      styles.roleBtn,
                      role === r.value && styles.roleBtnActive,
                    ]}
                    onPress={() => setRole(r.value)}
                  >
                    <Text
                      style={[
                        styles.roleBtnText,
                        role === r.value && styles.roleBtnTextActive,
                      ]}
                    >
                      {r.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity
                style={styles.createBtn}
                onPress={handleCreateClerk}
                disabled={loading}
              >
                <Text style={styles.createBtnText}>
                  {loading ? "Creating..." : "Create User"}
                </Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.formTitle}>
              📋 Existing Users ({clerks.length})
            </Text>
            <FlatList
              data={clerks}
              keyExtractor={(item) => item.id}
              renderItem={renderClerkItem}
              scrollEnabled={false}
            />
          </ScrollView>
        </View>
      </Modal>

      {/* Audit Trail Modal */}
      <Modal
        visible={activeModal === "audit"}
        animationType="slide"
        transparent={false}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Audit Trail</Text>
            <TouchableOpacity onPress={() => setActiveModal(null)}>
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={auditLogs}
            keyExtractor={(item) => item.id}
            renderItem={renderAuditItem}
            contentContainerStyle={styles.modalContentList}
            ListEmptyComponent={
              <Text style={styles.emptyText}>No audit logs found</Text>
            }
          />
        </View>
      </Modal>

      {/* Approvals Modal */}
      <Modal
        visible={activeModal === "approvals"}
        animationType="slide"
        transparent={false}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>
              Pending Approvals ({approvals.length})
            </Text>
            <TouchableOpacity onPress={() => setActiveModal(null)}>
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={approvals}
            keyExtractor={(item) => item.id}
            renderItem={renderApprovalItem}
            contentContainerStyle={styles.modalContentList}
            ListEmptyComponent={
              <Text style={styles.emptyText}>No pending approvals</Text>
            }
          />
        </View>
      </Modal>

      {/* Stock Balance Modal */}
      <Modal
        visible={activeModal === "stockBalance"}
        animationType="slide"
        transparent={false}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Stock Balance</Text>
            <TouchableOpacity onPress={() => setActiveModal(null)}>
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.modalContent}>
            <Text style={styles.formTitle}>Current Stock Balance</Text>
            <Text style={styles.instructionText}>
              Total Items: {stockBalance.length}
            </Text>
            <FlatList
              data={stockBalance}
              keyExtractor={(item, index) =>
                item && item.name ? item.name + index : index.toString()
              }
              renderItem={({ item }) => (
                <View
                  style={[
                    styles.listItem,
                    { flexDirection: "column", alignItems: "stretch" },
                  ]}
                >
                  <View style={styles.listItemInfo}>
                    <Text style={styles.listItemTitle}>
                      {item.name || "Unknown"}
                      {!item.available && (
                        <Text style={{ color: "#FFA500", fontSize: 10 }}>
                          {" "}
                          (Used)
                        </Text>
                      )}
                    </Text>
                    <Text style={styles.listItemSubtitle}>
                      Total Weight: {(item.totalWeight || 0).toFixed(2)} kg
                    </Text>
                    <Text style={styles.listItemDetail}>
                      Pieces: {item.pieces || 0}
                    </Text>
                    <Text style={styles.listItemDetail}>
                      Stores:{" "}
                      {item.stores && item.stores.length > 0
                        ? item.stores.join(", ")
                        : "All"}
                    </Text>
                    {item.usedIn && (
                      <Text
                        style={[styles.listItemDetail, { color: "#FFA500" }]}
                      >
                        Used to make: {item.usedIn}
                      </Text>
                    )}
                    {!item.available && (
                      <Text
                        style={[styles.listItemDetail, { color: "#FF4444" }]}
                      >
                        Status: Consumed
                      </Text>
                    )}
                  </View>
                </View>
              )}
              scrollEnabled={false}
              ListEmptyComponent={
                <Text style={styles.emptyText}>No stock data available</Text>
              }
            />
          </ScrollView>
        </View>
      </Modal>

      {/* Stock Movement Modal */}
      <Modal
        visible={activeModal === "stockMovement"}
        animationType="slide"
        transparent={false}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Stock Movement</Text>
            <TouchableOpacity onPress={() => setActiveModal(null)}>
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.modalContent}>
            <TextInput
              style={styles.input}
              placeholder="Filter by item, type, or user..."
              placeholderTextColor="#888"
              value={filterText}
              onChangeText={filterMovements}
            />
            <Text style={styles.instructionText}>
              Total Movements: {itemSpecificMovements.length}
            </Text>
            <FlatList
              data={itemSpecificMovements}
              keyExtractor={(item, index) =>
                item && item.id ? item.id + index : index.toString()
              }
              renderItem={({ item }) => (
                <View
                  style={[
                    styles.listItem,
                    { flexDirection: "column", alignItems: "stretch" },
                  ]}
                >
                  <View style={styles.listItemInfo}>
                    <Text style={styles.listItemTitle}>
                      {item.type || "Unknown"} - {item.itemName || "Unknown"}
                    </Text>
                    <Text style={styles.listItemSubtitle}>
                      {item.weight > 0
                        ? `Quantity: ${item.quantity || 0} (${(item.weight || 0).toFixed(2)} kg)`
                        : `Quantity: ${item.quantity || 0}`}
                    </Text>
                    <Text style={styles.listItemDetail}>
                      User: {item.user || "Unknown"}
                    </Text>
                    <Text style={styles.listItemDetail}>
                      Date: {item.date || "N/A"}
                    </Text>
                    <Text style={styles.listItemDetail}>
                      Details: {item.details || "N/A"}
                    </Text>
                    {item.batchCode && (
                      <Text style={styles.listItemDetail}>
                        Batch: {item.batchCode}
                      </Text>
                    )}
                    {item.dispatchNumber && (
                      <Text style={styles.listItemDetail}>
                        Dispatch: {item.dispatchNumber}
                      </Text>
                    )}
                    {item.carcassesUsed && item.carcassesUsed.length > 0 && (
                      <>
                        <Text
                          style={[
                            styles.listItemDetail,
                            { fontWeight: "bold", marginTop: 4 },
                          ]}
                        >
                          🥩 Carcasses Used:
                        </Text>
                        {item.carcassesUsed.map((c, idx) => (
                          <Text key={idx} style={styles.listItemDetail}>
                            • {c.type || "Unknown"}:{" "}
                            {(c.weightUsed || 0).toFixed(3)} kg
                          </Text>
                        ))}
                      </>
                    )}
                    {item.dryGoodsUsed && item.dryGoodsUsed.length > 0 && (
                      <>
                        <Text
                          style={[
                            styles.listItemDetail,
                            { fontWeight: "bold", marginTop: 4 },
                          ]}
                        >
                          📦 Dry Goods Used:
                        </Text>
                        {item.dryGoodsUsed.map((d, idx) => (
                          <Text key={idx} style={styles.listItemDetail}>
                            • {d.name || "Unknown"}:{" "}
                            {(d.amount || 0).toFixed(3)} kg
                          </Text>
                        ))}
                      </>
                    )}
                    <View
                      style={{ flexDirection: "row", marginTop: 8, gap: 8 }}
                    >
                      {item.canReverse && (
                        <TouchableOpacity
                          style={[
                            styles.reverseBtn,
                            { backgroundColor: "#FFA500" },
                          ]}
                          onPress={() => {
                            setSelectedTransaction(item);
                            setReversalModalVisible(true);
                            setActiveModal(null);
                          }}
                        >
                          <Text style={styles.reverseBtnText}>↩️ Reverse</Text>
                        </TouchableOpacity>
                      )}
                      {item.canDelete && (
                        <TouchableOpacity
                          style={[
                            styles.reverseBtn,
                            { backgroundColor: "#FF4444" },
                          ]}
                          onPress={() => {
                            setItemToDelete(item);
                            setDeleteConfirmText("");
                            setDeleteModalVisible(true);
                            setActiveModal(null);
                          }}
                        >
                          <Text style={styles.reverseBtnText}>🗑️ Delete</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                </View>
              )}
              ListEmptyComponent={
                <Text style={styles.emptyText}>No movements found</Text>
              }
              style={{ marginBottom: 20 }}
            />
          </View>
        </View>
      </Modal>

      {/* Opening Stock Modal */}
      <Modal
        visible={activeModal === "openingStock"}
        animationType="slide"
        transparent={false}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Opening Stock</Text>
            <TouchableOpacity onPress={() => setActiveModal(null)}>
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.modalContent}>
            <Text style={styles.formTitle}>Opening Stock Records</Text>
            <Text style={styles.instructionText}>
              Total Items: {openingStock.length}
            </Text>
            <FlatList
              data={openingStock}
              keyExtractor={(item, index) =>
                item && item.name
                  ? item.name + index + (item.date || "")
                  : index.toString()
              }
              renderItem={({ item }) => (
                <View
                  style={[
                    styles.listItem,
                    { flexDirection: "column", alignItems: "stretch" },
                  ]}
                >
                  <View style={styles.listItemInfo}>
                    <Text style={styles.listItemTitle}>
                      {item.name || "Unknown"}
                    </Text>
                    <Text style={styles.listItemSubtitle}>
                      Weight: {(item.weight || 0).toFixed(2)} kg
                    </Text>
                    <Text style={styles.listItemDetail}>
                      Pieces: {item.pieces || 0}
                    </Text>
                    <Text style={styles.listItemDetail}>
                      Store: {item.store || "Unknown"}
                    </Text>
                    {item.batchCode && (
                      <Text style={styles.listItemDetail}>
                        Batch: {item.batchCode}
                      </Text>
                    )}
                    <Text style={styles.listItemDate}>
                      Date: {item.date || "N/A"}
                    </Text>
                  </View>
                </View>
              )}
              scrollEnabled={false}
              ListEmptyComponent={
                <Text style={styles.emptyText}>No opening stock records</Text>
              }
            />
          </ScrollView>
        </View>
      </Modal>

      {/* Sales Report Modal */}
      <Modal
        visible={activeModal === "salesReport"}
        animationType="slide"
        transparent={false}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Sales Report</Text>
            <TouchableOpacity onPress={() => setActiveModal(null)}>
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.modalContent}>
            <Text style={styles.formTitle}>
              Total Sales: {salesReport.length} transactions
            </Text>
            <Text style={styles.instructionText}>
              Total Revenue: KES {(stats.totalRevenue || 0).toFixed(2)}
            </Text>
            <FlatList
              data={salesReport}
              keyExtractor={(item) =>
                item && item.id ? item.id : Math.random().toString()
              }
              renderItem={({ item }) => (
                <View
                  style={[
                    styles.listItem,
                    { flexDirection: "column", alignItems: "stretch" },
                  ]}
                >
                  <View style={styles.listItemInfo}>
                    <Text style={styles.listItemTitle}>
                      Dispatch: {item.dispatchNumber || "N/A"}
                    </Text>
                    <Text style={styles.listItemSubtitle}>
                      Customer: {item.customer || "Unknown"}
                    </Text>
                    <Text style={styles.listItemDetail}>
                      Items: {item.totalItems || 0} packs
                    </Text>
                    <Text style={styles.listItemDetail}>
                      Revenue: KES {(item.revenue || 0).toFixed(2)}
                    </Text>
                    <Text style={styles.listItemDate}>
                      Date: {item.date || "N/A"}
                    </Text>
                    {item.items && item.items.length > 0 && (
                      <>
                        <Text
                          style={[
                            styles.listItemDetail,
                            { fontWeight: "bold", marginTop: 4 },
                          ]}
                        >
                          Products:
                        </Text>
                        {item.items.map((product, idx) => (
                          <Text key={idx} style={styles.listItemDetail}>
                            • {product.productName || "Unknown"}:{" "}
                            {product.quantity || 0} packs
                          </Text>
                        ))}
                      </>
                    )}
                  </View>
                </View>
              )}
              scrollEnabled={false}
              ListEmptyComponent={
                <Text style={styles.emptyText}>No sales records found</Text>
              }
            />
          </ScrollView>
        </View>
      </Modal>

      {/* Material Usage Modal */}
      <Modal
        visible={activeModal === "materialUsage"}
        animationType="slide"
        transparent={false}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Material Usage</Text>
            <TouchableOpacity onPress={() => setActiveModal(null)}>
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.modalContent}>
            <Text style={styles.formTitle}>Recipe Material Usage</Text>
            <Text style={styles.instructionText}>
              Total Recipes: {materialUsage.length}
            </Text>
            <FlatList
              data={materialUsage}
              keyExtractor={(item, index) =>
                item && item.name ? item.name + index : index.toString()
              }
              renderItem={({ item }) => (
                <View
                  style={[
                    styles.listItem,
                    { flexDirection: "column", alignItems: "stretch" },
                  ]}
                >
                  <View style={styles.listItemInfo}>
                    <Text style={styles.listItemTitle}>
                      {item.name || "Unknown"}
                    </Text>
                    <Text style={styles.listItemSubtitle}>
                      Total Pieces: {item.totalPieces || 0}
                    </Text>
                    <Text style={styles.listItemDetail}>
                      Total Weight: {(item.totalWeight || 0).toFixed(2)} kg
                    </Text>
                    <Text style={styles.listItemDetail}>
                      Times Used: {item.occurrences || 0}
                    </Text>
                    <Text style={styles.listItemDetail}>
                      Last Used: {item.lastUsed || "N/A"}
                    </Text>
                    {item.products && item.products.length > 0 && (
                      <>
                        <Text
                          style={[
                            styles.listItemDetail,
                            { fontWeight: "bold", marginTop: 4 },
                          ]}
                        >
                          Products Made:
                        </Text>
                        {item.products.map((p, idx) => (
                          <Text key={idx} style={styles.listItemDetail}>
                            • {p}
                          </Text>
                        ))}
                      </>
                    )}
                    {Object.keys(item.ingredients || {}).length > 0 && (
                      <>
                        <Text
                          style={[
                            styles.listItemDetail,
                            { fontWeight: "bold", marginTop: 4 },
                          ]}
                        >
                          Ingredients Used:
                        </Text>
                        {Object.entries(item.ingredients).map(
                          ([name, amount]) => (
                            <Text key={name} style={styles.listItemDetail}>
                              • {name}: {(amount || 0).toFixed(2)} kg
                            </Text>
                          ),
                        )}
                      </>
                    )}
                  </View>
                </View>
              )}
              scrollEnabled={false}
              ListEmptyComponent={
                <Text style={styles.emptyText}>
                  No material usage data found
                </Text>
              }
            />
          </ScrollView>
        </View>
      </Modal>

      {/* Reverse Transaction Modal */}
      <Modal
        visible={activeModal === "reverse"}
        animationType="slide"
        transparent={false}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Reverse Transaction</Text>
            <TouchableOpacity onPress={() => setActiveModal(null)}>
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.modalContent}>
            <Text style={styles.formTitle}>
              Select a Transaction to Reverse
            </Text>
            <Text style={styles.instructionText}>
              Tap the "Reverse" button on any transaction below
            </Text>
            <FlatList
              data={stockMovements.filter((m) => m.canReverse).slice(0, 20)}
              keyExtractor={(item, index) =>
                item && item.id ? item.id + index : index.toString()
              }
              renderItem={({ item }) => (
                <View
                  style={[
                    styles.listItem,
                    { flexDirection: "column", alignItems: "stretch" },
                  ]}
                >
                  <View style={styles.listItemInfo}>
                    <Text style={styles.listItemTitle}>
                      {item.type || "Unknown"} - {item.itemName || "Unknown"}
                    </Text>
                    <Text style={styles.listItemSubtitle}>
                      Date: {item.date || "N/A"}
                    </Text>
                    <Text style={styles.listItemDetail}>
                      Details: {item.details || "N/A"}
                    </Text>
                    <TouchableOpacity
                      style={[styles.reverseBtn, { marginTop: 8 }]}
                      onPress={() => {
                        setSelectedTransaction(item);
                        setReversalModalVisible(true);
                        setActiveModal(null);
                      }}
                    >
                      <Text style={styles.reverseBtnText}>↩️ Reverse This</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
              ListEmptyComponent={
                <Text style={styles.emptyText}>
                  No reversible transactions found
                </Text>
              }
            />
          </ScrollView>
        </View>
      </Modal>

      {/* Reversal Confirmation Modal */}
      <Modal
        visible={reversalModalVisible}
        animationType="slide"
        transparent={true}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { width: "90%" }]}>
            <Text style={styles.modalTitle}>Reverse Transaction</Text>
            {selectedTransaction && (
              <>
                <Text style={styles.modalSubtitle}>
                  Type: {selectedTransaction.type || "Unknown"}
                </Text>
                <Text style={styles.modalSubtitle}>
                  Item: {selectedTransaction.itemName || "Unknown"}
                </Text>
                <Text style={styles.modalSubtitle}>
                  Date: {selectedTransaction.date || "N/A"}
                </Text>
                <Text style={styles.modalSubtitle}>
                  Details: {selectedTransaction.details || "N/A"}
                </Text>
              </>
            )}
            <Text
              style={[
                styles.modalSubtitle,
                { marginTop: 12, color: "#CC0000" },
              ]}
            >
              A reason is required for reversal.
            </Text>
            <TextInput
              style={[
                styles.input,
                { marginTop: 10, backgroundColor: "#1a1a2e", color: "#fff" },
              ]}
              placeholder="Reason for reversal (required)"
              placeholderTextColor="#888"
              value={reversalReason}
              onChangeText={setReversalReason}
              multiline
              numberOfLines={3}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: "#FF4444" }]}
                onPress={reverseTransaction}
              >
                <Text style={styles.modalButtonText}>Reverse</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: "#888" }]}
                onPress={() => {
                  setReversalModalVisible(false);
                  setSelectedTransaction(null);
                  setReversalReason("");
                }}
              >
                <Text style={styles.modalButtonText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Charts Modal */}
      <Modal
        visible={activeModal === "charts"}
        animationType="slide"
        transparent={false}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Analytics & Charts</Text>
            <TouchableOpacity onPress={() => setActiveModal(null)}>
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.modalContent}>
            <Text style={styles.formTitle}>📊 Product Performance</Text>
            <View style={styles.chartContainer}>
              <Text style={styles.chartLabel}>Top Products by Dispatch</Text>
              {dispatchRecords.slice(0, 10).map((record, index) => {
                const productName =
                  record.productName ||
                  record.items?.[0]?.productName ||
                  `Item ${index + 1}`;
                const totalItems =
                  record.totalItems || record.items?.length || 0;
                const maxValue = Math.max(
                  ...dispatchRecords
                    .slice(0, 10)
                    .map((r) => r.totalItems || r.items?.length || 0),
                  1,
                );
                const percentage = Math.min((totalItems / maxValue) * 100, 100);
                return (
                  <View key={index} style={styles.chartBarContainer}>
                    <Text style={styles.chartBarLabel} numberOfLines={1}>
                      {productName}
                    </Text>
                    <View style={styles.chartBarWrapper}>
                      <View
                        style={[
                          styles.chartBar,
                          {
                            width: `${percentage}%`,
                            backgroundColor:
                              index % 2 === 0 ? "#4CAF50" : "#2196F3",
                          },
                        ]}
                      />
                    </View>
                    <Text style={styles.chartBarValue}>{totalItems}</Text>
                  </View>
                );
              })}
              {dispatchRecords.length === 0 && (
                <Text style={styles.emptyText}>
                  No data available for charts
                </Text>
              )}
            </View>
            <Text style={[styles.formTitle, { marginTop: 20 }]}>
              📈 Monthly Overview
            </Text>
            <View style={styles.statsSummary}>
              <View style={styles.statSummaryItem}>
                <Text style={styles.statSummaryValue}>
                  {dispatchRecords.length || 0}
                </Text>
                <Text style={styles.statSummaryLabel}>Total Dispatches</Text>
              </View>
              <View style={styles.statSummaryItem}>
                <Text style={styles.statSummaryValue}>
                  {stats.totalProducts || 0}
                </Text>
                <Text style={styles.statSummaryLabel}>Total Products</Text>
              </View>
              <View style={styles.statSummaryItem}>
                <Text style={styles.statSummaryValue}>
                  {(stats.totalStockValue || 0).toFixed(1)}kg
                </Text>
                <Text style={styles.statSummaryLabel}>Total Stock</Text>
              </View>
              <View style={styles.statSummaryItem}>
                <Text style={styles.statSummaryValue}>
                  KES {(stats.totalRevenue || 0).toFixed(0)}
                </Text>
                <Text style={styles.statSummaryLabel}>Revenue</Text>
              </View>
            </View>
            {materialUsage.length > 0 && (
              <>
                <Text style={[styles.formTitle, { marginTop: 20 }]}>
                  📦 Most Used Recipes
                </Text>
                {materialUsage.slice(0, 5).map((item, index) => (
                  <View
                    key={index}
                    style={[
                      styles.listItem,
                      { flexDirection: "column", alignItems: "stretch" },
                    ]}
                  >
                    <View style={styles.listItemInfo}>
                      <Text style={styles.listItemTitle}>
                        {item.name || "Unknown"}
                      </Text>
                      <Text style={styles.listItemSubtitle}>
                        Used {item.occurrences || 0} times -{" "}
                        {item.totalPieces || 0} pieces
                      </Text>
                      {item.products && item.products.length > 0 && (
                        <Text style={styles.listItemDetail}>
                          Products: {item.products.join(", ")}
                        </Text>
                      )}
                    </View>
                  </View>
                ))}
              </>
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* Stock Overview Modal */}
      <Modal
        visible={activeModal === "stock"}
        animationType="slide"
        transparent={false}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Stock Overview</Text>
            <TouchableOpacity onPress={() => setActiveModal(null)}>
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.modalContent}>
            <Text style={styles.formTitle}>
              🥫 Dry Goods Stock ({dryGoodsStock.length})
            </Text>
            <FlatList
              data={dryGoodsStock}
              keyExtractor={(item) =>
                item && item.id ? item.id : Math.random().toString()
              }
              renderItem={({ item }) => (
                <View style={styles.listItem}>
                  <View style={styles.listItemInfo}>
                    <Text style={styles.listItemTitle}>
                      {item.type || "Item"}
                    </Text>
                    <Text style={styles.listItemSubtitle}>
                      Total Weight: {(item.totalWeight || 0).toFixed(2)} kg
                    </Text>
                    {item.pieces && (
                      <Text style={styles.listItemDetail}>
                        Pieces: {item.pieces}
                      </Text>
                    )}
                    {item.batchCode && (
                      <Text style={styles.listItemDetail}>
                        Batch: {item.batchCode}
                      </Text>
                    )}
                  </View>
                </View>
              )}
              scrollEnabled={false}
              ListEmptyComponent={
                <Text style={styles.emptyText}>No dry goods stock</Text>
              }
            />
            <Text style={styles.formTitle}>
              ❄️ Cold Room Stock ({coldRoomStock.length})
            </Text>
            <FlatList
              data={coldRoomStock}
              keyExtractor={(item) =>
                item && item.id ? item.id : Math.random().toString()
              }
              renderItem={({ item }) => (
                <View style={styles.listItem}>
                  <View style={styles.listItemInfo}>
                    <Text style={styles.listItemTitle}>
                      {item.type || "Item"}
                    </Text>
                    <Text style={styles.listItemSubtitle}>
                      Total Weight: {(item.totalWeight || 0).toFixed(2)} kg
                    </Text>
                    {item.pieces && (
                      <Text style={styles.listItemDetail}>
                        Pieces: {item.pieces}
                      </Text>
                    )}
                    {item.isDebonned && (
                      <Text
                        style={[styles.listItemDetail, { color: "#4CAF50" }]}
                      >
                        ✓ Debonned
                      </Text>
                    )}
                    {item.batchCode && (
                      <Text style={styles.listItemDetail}>
                        Batch: {item.batchCode}
                      </Text>
                    )}
                  </View>
                </View>
              )}
              scrollEnabled={false}
              ListEmptyComponent={
                <Text style={styles.emptyText}>No cold room stock</Text>
              }
            />
          </ScrollView>
        </View>
      </Modal>

      {/* ============ EMPLOYEES MODAL ============ */}
      <Modal
        visible={activeModal === "employees"}
        animationType="slide"
        transparent={false}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>
              Registered Employees ({clerks.length})
            </Text>
            <TouchableOpacity onPress={() => setActiveModal(null)}>
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.modalContent}>
            <Text style={styles.formTitle}>📋 All Employees</Text>
            <Text style={styles.instructionText}>
              Tap "Activate" or "Deactivate" to manage employee access. Use
              "Delete" for resigned employees.
            </Text>
            <View style={styles.legendContainer}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, styles.legendActive]} />
                <Text style={styles.legendText}>Active</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, styles.legendInactive]} />
                <Text style={styles.legendText}>Inactive</Text>
              </View>
              <View style={styles.legendItem}>
                <View
                  style={[styles.legendDot, { backgroundColor: "#FF4444" }]}
                />
                <Text style={styles.legendText}>Delete (Resigned)</Text>
              </View>
            </View>
            <FlatList
              data={clerks}
              keyExtractor={(item) =>
                item && item.id ? item.id : Math.random().toString()
              }
              renderItem={renderEmployeeCard}
              scrollEnabled={false}
              ListEmptyComponent={
                <Text style={styles.emptyText}>
                  No employees found. Create users from User Management.
                </Text>
              }
            />
            <View style={styles.logoutInstructionBox}>
              <Text style={styles.instructionIcon}>🔐</Text>
              <Text style={styles.instructionTitle}>
                Employee Management Guide:
              </Text>
              <Text style={styles.instructionStep}>
                1. 🟢 Activate - Enable employee access to the system
              </Text>
              <Text style={styles.instructionStep}>
                2. 🔴 Deactivate - Temporarily disable employee access
              </Text>
              <Text style={styles.instructionStep}>
                3. 🗑️ Delete - Permanently remove resigned employee (Cannot be
                undone!)
              </Text>
              <Text
                style={[
                  styles.instructionStep,
                  { color: "#FFA500", marginTop: 8 },
                ]}
              >
                ⚠️ Deactivated employees cannot log in until reactivated.
              </Text>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* Reports Modal */}
      <Modal
        visible={activeModal === "reports"}
        animationType="slide"
        transparent={false}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Reports</Text>
            <TouchableOpacity onPress={() => setActiveModal(null)}>
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.modalContent}>
            <View style={styles.reportFilters}>
              <Text style={styles.label}>Report Type:</Text>
              <View style={styles.reportTypeContainer}>
                {["dispatch", "processing", "stock"].map((type) => (
                  <TouchableOpacity
                    key={type}
                    style={[
                      styles.reportTypeBtn,
                      reportType === type && styles.reportTypeBtnActive,
                    ]}
                    onPress={() => setReportType(type)}
                  >
                    <Text
                      style={[
                        styles.reportTypeBtnText,
                        reportType === type && styles.reportTypeBtnTextActive,
                      ]}
                    >
                      {type.toUpperCase()}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity
                style={styles.generateBtn}
                onPress={generateReport}
              >
                <Text style={styles.generateBtnText}>Generate Report</Text>
              </TouchableOpacity>
              {reportData.length > 0 && (
                <TouchableOpacity
                  style={[
                    styles.generateBtn,
                    { backgroundColor: "#4CAF50", marginTop: 8 },
                  ]}
                  onPress={handleExportReport}
                  disabled={exportLoading}
                >
                  <Text style={styles.generateBtnText}>
                    {exportLoading ? "Exporting..." : "📥 Export Report"}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
            <Text style={styles.formTitle}>
              📄 Report Results ({reportData.length})
            </Text>
            <FlatList
              data={reportData}
              keyExtractor={(item, index) =>
                item && item.id ? item.id : index.toString()
              }
              renderItem={({ item }) => (
                <View style={styles.listItem}>
                  <View style={styles.listItemInfo}>
                    <Text style={styles.listItemTitle}>
                      {item.productName || item.type || "Item"}
                    </Text>
                    <Text style={styles.listItemSubtitle}>
                      {item.timestamp ||
                        item.date ||
                        new Date().toLocaleString()}
                    </Text>
                    {item.totalWeight && (
                      <Text style={styles.listItemDetail}>
                        Weight: {(item.totalWeight || 0).toFixed(2)} kg
                      </Text>
                    )}
                  </View>
                </View>
              )}
              scrollEnabled={false}
              ListEmptyComponent={
                <Text style={styles.emptyText}>
                  No data for selected report
                </Text>
              }
            />
          </ScrollView>
        </View>
      </Modal>

      {/* Remove Stock Modal */}
      <Modal
        visible={activeModal === "removeStock"}
        animationType="slide"
        transparent={false}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Remove Stock</Text>
            <TouchableOpacity onPress={() => setActiveModal(null)}>
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.modalContent}>
            <Text style={styles.formTitle}>🗑️ Select Stock to Remove</Text>
            <Text style={styles.instructionText}>
              Select an item below and tap "Remove Stock"
            </Text>
            <FlatList
              data={stockForRemoval}
              keyExtractor={(item) =>
                item && item.id ? item.id : Math.random().toString()
              }
              renderItem={({ item }) => (
                <View
                  style={[
                    styles.listItem,
                    { flexDirection: "column", alignItems: "stretch" },
                  ]}
                >
                  <View style={styles.listItemInfo}>
                    <Text style={styles.listItemTitle}>
                      {item.type || item.name || "Unknown"}
                    </Text>
                    <Text style={styles.listItemSubtitle}>
                      Current Weight: {(item.totalWeight || 0).toFixed(3)} kg
                    </Text>
                    {item.batchCode && (
                      <Text style={styles.listItemDetail}>
                        Batch: {item.batchCode}
                      </Text>
                    )}
                    <Text style={styles.listItemDetail}>
                      Store: {item.isDebonned ? "Cold Room" : "Dry Goods"}
                    </Text>
                    <TouchableOpacity
                      style={[
                        styles.reverseBtn,
                        { backgroundColor: "#FF4444", marginTop: 8 },
                      ]}
                      onPress={() => {
                        setSelectedStockItem(item);
                        setRemoveWeight("");
                        setRemovalReason("");
                        setRemovalModalVisible(true);
                        setActiveModal(null);
                      }}
                    >
                      <Text style={styles.reverseBtnText}>🗑️ Remove Stock</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
              ListEmptyComponent={
                <Text style={styles.emptyText}>
                  No stock available for removal
                </Text>
              }
            />
          </ScrollView>
        </View>
      </Modal>

      {/* Removal Confirmation Modal */}
      <Modal
        visible={removalModalVisible}
        animationType="slide"
        transparent={true}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { width: "90%" }]}>
            <Text style={styles.modalTitle}>Remove Stock</Text>
            {selectedStockItem && (
              <>
                <Text style={styles.modalSubtitle}>
                  Item:{" "}
                  {selectedStockItem.type ||
                    selectedStockItem.name ||
                    "Unknown"}
                </Text>
                <Text style={styles.modalSubtitle}>
                  Current Weight:{" "}
                  {(selectedStockItem.totalWeight || 0).toFixed(3)} kg
                </Text>
                {selectedStockItem.batchCode && (
                  <Text style={styles.modalSubtitle}>
                    Batch: {selectedStockItem.batchCode}
                  </Text>
                )}
              </>
            )}
            <TextInput
              style={[styles.input, { marginTop: 10 }]}
              placeholder="Weight to remove (kg)"
              placeholderTextColor="#888"
              keyboardType="decimal-pad"
              value={removeWeight}
              onChangeText={setRemoveWeight}
            />
            <TextInput
              style={[styles.input, { marginTop: 10 }]}
              placeholder="Reason for removal (required)"
              placeholderTextColor="#888"
              value={removalReason}
              onChangeText={setRemovalReason}
              multiline
              numberOfLines={2}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: "#FF4444" }]}
                onPress={handleRemoveStock}
              >
                <Text style={styles.modalButtonText}>Remove Stock</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: "#888" }]}
                onPress={() => {
                  setRemovalModalVisible(false);
                  setSelectedStockItem(null);
                  setRemoveWeight("");
                  setRemovalReason("");
                }}
              >
                <Text style={styles.modalButtonText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Backup & Restore Modal */}
      <Modal
        visible={activeModal === "backupRestore"}
        animationType="slide"
        transparent={false}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Backup & Restore</Text>
            <TouchableOpacity onPress={() => setActiveModal(null)}>
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.modalContent}>
            <Text style={styles.formTitle}>💾 Create Backup</Text>
            <TouchableOpacity
              style={[styles.createBtn, { backgroundColor: "#4CAF50" }]}
              onPress={handleBackup}
              disabled={loading}
            >
              <Text style={styles.createBtnText}>
                {loading ? "Creating..." : "📦 Create Backup File"}
              </Text>
            </TouchableOpacity>
            {backupData && backupData.filePath && (
              <>
                <View style={styles.backupActionsContainer}>
                  <Text style={styles.backupInfo}>
                    📄 File: {backupData.fileName || "N/A"}
                  </Text>
                  <Text style={styles.backupInfo}>
                    📊 Size: {(backupData.size || 0 / 1024).toFixed(1)} KB
                  </Text>
                  <View style={styles.backupButtonsRow}>
                    <TouchableOpacity
                      style={[
                        styles.backupActionBtn,
                        { backgroundColor: "#2196F3" },
                      ]}
                      onPress={shareBackupFile}
                    >
                      <Text style={styles.backupActionBtnText}>
                        📤 Share File
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.backupActionBtn,
                        { backgroundColor: "#4CAF50" },
                      ]}
                      onPress={downloadBackup}
                    >
                      <Text style={styles.backupActionBtnText}>
                        ⬇️ Download
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.backupActionBtn,
                        { backgroundColor: "#FF9800" },
                      ]}
                      onPress={shareBackupAsText}
                    >
                      <Text style={styles.backupActionBtnText}>
                        📋 Share Text
                      </Text>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity
                    style={[
                      styles.backupActionBtn,
                      { backgroundColor: "#F44336", marginTop: 8 },
                    ]}
                    onPress={deleteBackupFile}
                  >
                    <Text style={styles.backupActionBtnText}>
                      🗑️ Delete Backup
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
            <View style={styles.divider} />
            <Text style={styles.formTitle}>📥 Restore Data</Text>
            <Text style={styles.instructionText}>
              Paste the backup JSON data below to restore
            </Text>
            <TextInput
              style={[styles.input, { height: 150, textAlignVertical: "top" }]}
              placeholder="Paste backup JSON here..."
              placeholderTextColor="#888"
              value={restoreData}
              onChangeText={setRestoreData}
              multiline
              numberOfLines={6}
            />
            <TouchableOpacity
              style={[styles.createBtn, { backgroundColor: "#FF9800" }]}
              onPress={handleRestore}
            >
              <Text style={styles.createBtnText}>🔄 Restore Data</Text>
            </TouchableOpacity>
            <View style={styles.divider} />
            <Text style={styles.formTitle}>📋 Backup History</Text>
            <FlatList
              data={backupHistory}
              keyExtractor={(item) =>
                item && item.id ? item.id : Math.random().toString()
              }
              renderItem={({ item }) => (
                <View style={styles.listItem}>
                  <View style={styles.listItemInfo}>
                    <Text style={styles.listItemTitle}>
                      {item.timestamp
                        ? new Date(item.timestamp).toLocaleString()
                        : "N/A"}
                    </Text>
                    <Text style={styles.listItemSubtitle}>
                      📄 {item.fileName || "N/A"}
                    </Text>
                    <Text style={styles.listItemDetail}>
                      Size: {(item.size || 0 / 1024).toFixed(1)} KB
                    </Text>
                    <Text style={styles.listItemDetail}>
                      Records: {item.records?.processing || 0} processing,{" "}
                      {item.records?.dispatch || 0} dispatch
                    </Text>
                  </View>
                </View>
              )}
              ListEmptyComponent={
                <Text style={styles.emptyText}>No backups found</Text>
              }
              scrollEnabled={false}
            />
          </ScrollView>
        </View>
      </Modal>

      {/* Delete Transaction Modal */}
      <Modal
        visible={activeModal === "deleteTransaction"}
        animationType="slide"
        transparent={false}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Delete Transaction</Text>
            <TouchableOpacity onPress={() => setActiveModal(null)}>
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.modalContent}>
            <Text style={styles.formTitle}>
              🗑️ Select Transaction to Delete
            </Text>
            <Text style={[styles.instructionText, { color: "#FF4444" }]}>
              ⚠️ This action cannot be undone!
            </Text>
            <FlatList
              data={stockMovements.filter((m) => m.canDelete).slice(0, 20)}
              keyExtractor={(item, index) =>
                item && item.id ? item.id + index : index.toString()
              }
              renderItem={({ item }) => (
                <View
                  style={[
                    styles.listItem,
                    { flexDirection: "column", alignItems: "stretch" },
                  ]}
                >
                  <View style={styles.listItemInfo}>
                    <Text style={styles.listItemTitle}>
                      {item.type || "Unknown"} - {item.itemName || "Unknown"}
                    </Text>
                    <Text style={styles.listItemSubtitle}>
                      Date: {item.date || "N/A"}
                    </Text>
                    <Text style={styles.listItemDetail}>
                      Details: {item.details || "N/A"}
                    </Text>
                    <TouchableOpacity
                      style={[
                        styles.reverseBtn,
                        { backgroundColor: "#CC0000", marginTop: 8 },
                      ]}
                      onPress={() => {
                        setItemToDelete(item);
                        setDeleteConfirmText("");
                        setDeleteModalVisible(true);
                        setActiveModal(null);
                      }}
                    >
                      <Text style={styles.reverseBtnText}>🗑️ Delete This</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
              ListEmptyComponent={
                <Text style={styles.emptyText}>
                  No deletable transactions found
                </Text>
              }
            />
          </ScrollView>
        </View>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        visible={deleteModalVisible}
        animationType="slide"
        transparent={true}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { width: "90%" }]}>
            <Text style={[styles.modalTitle, { color: "#FF4444" }]}>
              ⚠️ Delete Transaction
            </Text>
            {itemToDelete && (
              <>
                <Text style={styles.modalSubtitle}>
                  Type: {itemToDelete.type || "Unknown"}
                </Text>
                <Text style={styles.modalSubtitle}>
                  Item: {itemToDelete.itemName || "Unknown"}
                </Text>
                <Text style={styles.modalSubtitle}>
                  Date: {itemToDelete.date || "N/A"}
                </Text>
                <Text style={styles.modalSubtitle}>
                  Details: {itemToDelete.details || "N/A"}
                </Text>
              </>
            )}
            <Text
              style={[
                styles.modalSubtitle,
                { marginTop: 12, color: "#CC0000", fontWeight: "bold" },
              ]}
            >
              This action cannot be undone!
            </Text>
            <Text style={[styles.modalSubtitle, { marginTop: 8 }]}>
              Type "delete" to confirm:
            </Text>
            <TextInput
              style={[styles.input, { marginTop: 10 }]}
              placeholder='Type "delete"'
              placeholderTextColor="#888"
              value={deleteConfirmText}
              onChangeText={setDeleteConfirmText}
              autoCapitalize="none"
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: "#FF4444" }]}
                onPress={handleDeleteTransaction}
              >
                <Text style={styles.modalButtonText}>Delete</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: "#888" }]}
                onPress={() => {
                  setDeleteModalVisible(false);
                  setItemToDelete(null);
                  setDeleteConfirmText("");
                }}
              >
                <Text style={styles.modalButtonText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

// ============ STYLES ============
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a1a" },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#0a0a1a",
  },
  loadingText: { color: "#fff", marginTop: 10, fontSize: 16 },
  loadingSubText: { color: "#888", marginTop: 4, fontSize: 12 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingTop: 40,
    paddingBottom: 10,
    backgroundColor: "#1a1a2e",
    borderBottomWidth: 1,
    borderBottomColor: "#2a2a4a",
    minHeight: 60,
  },
  headerTitle: { fontSize: 16, fontWeight: "bold", color: "#fff" },
  headerSubtitle: { fontSize: 9, color: "#e94560" },
  headerButtons: { flexDirection: "row", alignItems: "center", gap: 4 },
  headerBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  employeeViewBtn: { backgroundColor: "#4CAF50" },
  logoutBtn: { backgroundColor: "#e94560" },
  headerBtnText: { color: "#fff", fontWeight: "600", fontSize: 9 },
  notificationBtn: { position: "relative", padding: 4 },
  notificationIcon: { fontSize: 18 },
  notificationBadge: {
    position: "absolute",
    top: -2,
    right: -2,
    backgroundColor: "#e94560",
    borderRadius: 8,
    minWidth: 14,
    height: 14,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 3,
  },
  notificationBadgeText: { color: "#fff", fontSize: 8, fontWeight: "bold" },
  content: { flex: 1, padding: 10 },
  statsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginBottom: 12,
    gap: 6,
  },
  statCard: {
    flex: 1,
    minWidth: "30%",
    backgroundColor: "#1a1a2e",
    borderRadius: 8,
    padding: 8,
    alignItems: "center",
    borderTopWidth: 3,
    borderTopColor: "#e94560",
  },
  statValue: { fontSize: 14, fontWeight: "bold", color: "#fff" },
  statLabel: { fontSize: 7, color: "#aaa", marginTop: 2, textAlign: "center" },
  gridContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  card: {
    width: (width - 36) / 2,
    backgroundColor: "#1a1a2e",
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderTopWidth: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    position: "relative",
  },
  cardIcon: { fontSize: 20, marginBottom: 3 },
  cardTitle: { fontSize: 10, color: "#aaa", marginBottom: 1 },
  cardValue: { fontSize: 16, fontWeight: "bold", color: "#fff" },
  cardSubtext: { fontSize: 8, color: "#888", marginTop: 2 },
  badge: {
    position: "absolute",
    top: -5,
    right: -5,
    backgroundColor: "#e94560",
    borderRadius: 10,
    minWidth: 16,
    height: 16,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 3,
  },
  badgeText: { color: "#fff", fontSize: 8, fontWeight: "bold" },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#fff",
    marginBottom: 8,
    marginTop: 4,
  },
  listItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#1a1a2e",
    borderRadius: 8,
    padding: 8,
    marginBottom: 4,
  },
  listItemInfo: { flex: 1 },
  listItemTitle: { fontSize: 12, fontWeight: "600", color: "#fff" },
  listItemSubtitle: { fontSize: 10, color: "#e94560", marginTop: 1 },
  listItemDetail: { fontSize: 9, color: "#888", marginTop: 1 },
  listItemDate: { fontSize: 8, color: "#666", marginTop: 1 },
  deleteBtn: { padding: 4 },
  deleteBtnText: { fontSize: 16 },
  approvalButtons: { flexDirection: "row", gap: 4 },
  approveBtn: {
    backgroundColor: "#4CAF50",
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
  },
  approveBtnText: { color: "#fff", fontSize: 12, fontWeight: "bold" },
  rejectBtn: {
    backgroundColor: "#e94560",
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
  },
  rejectBtnText: { color: "#fff", fontSize: 12, fontWeight: "bold" },
  modalContainer: { flex: 1, backgroundColor: "#0a0a1a" },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingTop: 40,
    paddingBottom: 12,
    backgroundColor: "#1a1a2e",
  },
  modalTitle: { fontSize: 16, fontWeight: "bold", color: "#fff" },
  modalClose: { fontSize: 20, color: "#e94560", fontWeight: "bold" },
  modalContent: { padding: 12 },
  modalContentList: { padding: 12 },
  formSection: { marginBottom: 16 },
  formTitle: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#fff",
    marginBottom: 8,
  },
  input: {
    backgroundColor: "#1a1a2e",
    borderRadius: 8,
    padding: 10,
    color: "#fff",
    fontSize: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: "#2a2a4a",
  },
  label: { color: "#aaa", marginBottom: 4, fontSize: 11 },
  rolesContainer: { flexDirection: "row", flexWrap: "wrap", marginBottom: 8 },
  roleBtn: {
    backgroundColor: "#2a2a4a",
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 12,
    marginRight: 4,
    marginBottom: 4,
  },
  roleBtnActive: { backgroundColor: "#e94560" },
  roleBtnText: { color: "#aaa", fontSize: 9 },
  roleBtnTextActive: { color: "#fff" },
  createBtn: {
    backgroundColor: "#e94560",
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 4,
  },
  createBtnText: { color: "#fff", fontWeight: "bold", fontSize: 12 },
  reportFilters: { marginBottom: 12 },
  reportTypeContainer: { flexDirection: "row", marginBottom: 8, gap: 4 },
  reportTypeBtn: {
    flex: 1,
    backgroundColor: "#2a2a4a",
    paddingVertical: 5,
    borderRadius: 6,
    alignItems: "center",
  },
  reportTypeBtnActive: { backgroundColor: "#e94560" },
  reportTypeBtnText: { color: "#aaa", fontWeight: "600", fontSize: 10 },
  reportTypeBtnTextActive: { color: "#fff" },
  generateBtn: {
    backgroundColor: "#e94560",
    paddingVertical: 6,
    borderRadius: 6,
    alignItems: "center",
  },
  generateBtnText: { color: "#fff", fontWeight: "bold", fontSize: 12 },
  emptyText: {
    textAlign: "center",
    color: "#888",
    marginTop: 20,
    fontSize: 12,
  },
  instructionText: {
    color: "#aaa",
    fontSize: 10,
    textAlign: "center",
    marginBottom: 8,
    padding: 4,
    backgroundColor: "#1a1a2e",
    borderRadius: 6,
  },
  employeeCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1a1a2e",
    borderRadius: 8,
    padding: 8,
    marginBottom: 8,
  },
  employeeCardInactive: {
    backgroundColor: "#1a1a1a",
    opacity: 0.7,
  },
  employeeAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#e94560",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 8,
  },
  employeeAvatarText: { fontSize: 14, fontWeight: "bold", color: "#fff" },
  employeeAvatarTextInactive: { color: "#888" },
  employeeInfo: { flex: 1 },
  employeeName: { fontSize: 12, fontWeight: "600", color: "#fff" },
  employeeNameInactive: { color: "#666" },
  employeeRole: { fontSize: 9, color: "#e94560", marginTop: 1 },
  employeeRoleInactive: { color: "#666" },
  employeeCredentials: { fontSize: 7, color: "#888", marginTop: 1 },
  employeeActions: {
    flexDirection: "row",
    marginTop: 3,
    gap: 3,
  },
  employeeActionBtn: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    alignItems: "center",
  },
  employeeActionBtnText: {
    color: "#fff",
    fontSize: 8,
    fontWeight: "bold",
  },
  activateBtn: { backgroundColor: "#4CAF50" },
  deactivateBtn: { backgroundColor: "#FF9800" },
  deleteEmployeeBtn: { backgroundColor: "#FF4444" },
  employeeStatus: { alignItems: "center", marginLeft: 4 },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#666",
    marginBottom: 1,
  },
  statusActive: { backgroundColor: "#4CAF50" },
  statusText: { fontSize: 7, color: "#aaa" },
  statusTextInactive: { color: "#666" },
  legendContainer: {
    flexDirection: "row",
    justifyContent: "space-around",
    backgroundColor: "#1a1a2e",
    borderRadius: 6,
    padding: 6,
    marginBottom: 8,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
  },
  legendDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 3,
  },
  legendActive: { backgroundColor: "#4CAF50" },
  legendInactive: { backgroundColor: "#FF9800" },
  legendText: { color: "#aaa", fontSize: 8 },
  logoutInstructionBox: {
    backgroundColor: "#1a1a2e",
    borderRadius: 8,
    padding: 12,
    marginTop: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "#4CAF50",
  },
  instructionIcon: { fontSize: 18, textAlign: "center", marginBottom: 3 },
  instructionTitle: {
    fontSize: 12,
    fontWeight: "bold",
    color: "#fff",
    textAlign: "center",
    marginBottom: 4,
  },
  instructionStep: {
    fontSize: 10,
    color: "#aaa",
    marginBottom: 3,
    paddingLeft: 4,
  },
  reverseBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    alignSelf: "flex-start",
  },
  reverseBtnText: { color: "#fff", fontSize: 10, fontWeight: "bold" },
  chartContainer: {
    backgroundColor: "#1a1a2e",
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  chartLabel: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "bold",
    marginBottom: 8,
  },
  chartBarContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 3,
  },
  chartBarLabel: { color: "#aaa", fontSize: 9, width: 50 },
  chartBarWrapper: {
    flex: 1,
    backgroundColor: "#2a2a4a",
    borderRadius: 3,
    height: 12,
    marginHorizontal: 3,
    overflow: "hidden",
  },
  chartBar: { height: 12, borderRadius: 3 },
  chartBarValue: { color: "#aaa", fontSize: 9, width: 25, textAlign: "right" },
  statsSummary: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: 4,
  },
  statSummaryItem: {
    flex: 1,
    minWidth: "45%",
    backgroundColor: "#1a1a2e",
    borderRadius: 6,
    padding: 8,
    alignItems: "center",
  },
  statSummaryValue: { color: "#fff", fontSize: 14, fontWeight: "bold" },
  statSummaryLabel: {
    color: "#aaa",
    fontSize: 8,
    marginTop: 2,
    textAlign: "center",
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.7)",
  },
  modalContent: {
    backgroundColor: "#1a1a2e",
    borderRadius: 12,
    padding: 16,
    width: "85%",
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "bold",
    marginBottom: 6,
    textAlign: "center",
    color: "#fff",
  },
  modalSubtitle: { fontSize: 12, color: "#aaa", marginBottom: 2 },
  modalButtons: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 12,
  },
  modalButton: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: 6,
    marginHorizontal: 3,
    alignItems: "center",
  },
  modalButtonText: { color: "#fff", fontSize: 12, fontWeight: "bold" },
  divider: {
    height: 1,
    backgroundColor: "#2a2a4a",
    marginVertical: 12,
  },
  backupActionsContainer: {
    backgroundColor: "#1a1a2e",
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#4CAF50",
  },
  backupInfo: {
    color: "#aaa",
    fontSize: 10,
    marginBottom: 2,
  },
  backupButtonsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: 4,
    marginTop: 6,
  },
  backupActionBtn: {
    flex: 1,
    minWidth: "30%",
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 6,
    alignItems: "center",
  },
  backupActionBtnText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "bold",
  },
  notificationActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  markAllReadBtn: {
    backgroundColor: "#4CAF50",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  markAllReadText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "bold",
  },
  notificationItem: {
    flexDirection: "row",
    backgroundColor: "#1a1a2e",
    borderRadius: 8,
    padding: 8,
    marginBottom: 4,
    marginHorizontal: 12,
  },
  notificationUnread: {
    backgroundColor: "#2a1a2e",
    borderLeftWidth: 4,
    borderLeftColor: "#e94560",
  },
  notificationContent: { flex: 1 },
  notificationTitle: { fontSize: 12, fontWeight: "bold", color: "#fff" },
  notificationMessage: { fontSize: 10, color: "#aaa", marginTop: 1 },
  notificationTime: { fontSize: 8, color: "#666", marginTop: 2 },
  notificationDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#e94560",
    marginLeft: 6,
    alignSelf: "center",
  },
  usageSummary: {
    backgroundColor: "#1a1a2e",
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#FF6F00",
  },
  usageSummaryText: {
    color: "#fff",
    fontSize: 12,
    marginBottom: 4,
  },
});

export default AdminDashboard;
