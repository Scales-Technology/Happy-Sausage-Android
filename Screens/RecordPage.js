import * as Network from "expo-network";
import {
  StyleSheet,
  Text,
  View,
  Dimensions,
  TouchableOpacity,
  ScrollView,
  Modal,
  ActivityIndicator,
  ToastAndroid,
  SafeAreaView,
  Platform,
} from "react-native";
import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from "react";
import Header from "../Components/Header";
import AntDesign from "@expo/vector-icons/AntDesign";
import {
  addDoc,
  collection,
  getDocs,
  query,
  orderBy,
} from "firebase/firestore";
import { db } from "../Database/config";
import { store } from "../store/store";
import { useSelector } from "react-redux";
import { setCollections } from "../store";
import { useBluetooth } from "rn-bluetooth-classic";

const { width: screenWidth, height: screenHeight } = Dimensions.get("window");

// Responsive sizing functions
const responsiveSize = (size) => {
  const standardWidth = 375;
  return (screenWidth * size) / standardWidth;
};

// Fixed cell size - consistent for all boxes
const CELL_SIZE = 50; // Fixed size for all boxes

// Calculate how many columns fit on screen + extra to fill space
const MIN_COLUMNS = 6;
const COLUMNS_PER_SCREEN = Math.floor(screenWidth / CELL_SIZE);
const TOTAL_PAIRS = Math.max(
  MIN_COLUMNS,
  Math.ceil(COLUMNS_PER_SCREEN / 2) + 2,
);
const TOTAL_COLUMNS = TOTAL_PAIRS * 2;

const RecordPage = ({ route, navigation }) => {
  // FIXED: Extract all parameters properly
  console.log("=== RECORDPAGE PARAMS ===");
  console.log(JSON.stringify(route.params, null, 2));

  const params = route.params || {};

  // Extract all parameters with proper fallbacks - IMPORTANT: Check for supplier object
  const supplier = params.supplier || {
    id: params.supplierId || params.clientId || "",
    name: params.supplierName || params.clientName || "No Client",
    fName: params.clientFirstName || "",
    lName: params.clientLastName || "",
    phoneNumber: params.clientPhone || "",
    location: params.clientLocation || "",
  };

  const clientId = supplier.id || "";
  const clientName = supplier.name || "No Client";
  const destinationId = params.destinationId || "";
  const destinationName = params.destinationName || "No Destination";
  const batchCode = params.batchCode || "No Batch";
  const carcasTypeId = params.carcasTypeId || "";
  const carcasTypeName = params.carcasTypeName || "No Type";
  const tagId = params.tagId || "";
  const ageMonths = params.ageMonths || 0;

  console.log("Extracted Data:", {
    supplier,
    clientName,
    destinationName,
    batchCode,
    carcasTypeName,
  });

  const collections = useSelector((state) => state.settings.collections) || [];
  const { BusinessId, user } = useSelector((state) => state.settings) || {};

  const [modalVisible, setModalVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [carcusPieces, setCarcusPieces] = useState(
    Array.from({ length: TOTAL_COLUMNS * 20 }, () => ({ pcs: 0, weight: 0 })),
  );
  const [previousRecords, setPreviousRecords] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  const { connectToDevice, receivedData, writeToDevice } = useBluetooth();

  const [scaleData, setScaleData] = useState({
    reading: null,
    isStable: false,
  });
  const [canCaptureWeight, setCanCaptureWeight] = useState(false);
  const [waitingForZero, setWaitingForZero] = useState(true);
  const [selectedPairIndices, setSelectedPairIndices] = useState([]);
  const [showDelete, setShowDelete] = useState(false);

  const previousWeight = useRef(0);
  const currentRowIndex = useRef(0);
  const currentColumnPair = useRef(0);
  const settleTimeout = useRef(null);
  const weightHistory = useRef([]);
  const isCountingEnabled = useRef(true);

  // Debug useEffect
  useEffect(() => {
    console.log("RecordPage mounted with supplier object:", supplier);
  }, []);

  // === PARSE BLUETOOTH DATA ===
  useEffect(() => {
    if (receivedData) {console.log(
      "[SCALE RAW DATA]",
      typeof receivedData,
      JSON.stringify(receivedData),
    );
      const parsedData = parseBluetoothData(receivedData);
      if (
        parsedData.reading !== null &&
        JSON.stringify(parsedData) !== JSON.stringify(scaleData)
      ) {
        setScaleData(parsedData);
      }
    }
  }, [receivedData]);

  // === SIMPLE PIECE COUNTING LOGIC ===
  useEffect(() => {
    if (
      scaleData.isStable &&
      scaleData.reading !== null &&
      isCountingEnabled.current
    ) {
      const currentWeight =
        parseFloat(scaleData.reading.replace("kg", "")) || 0;

      weightHistory.current.push({
        weight: currentWeight,
        timestamp: Date.now(),
      });

      if (weightHistory.current.length > 5) {
        weightHistory.current.shift();
      }

      const weightChange = currentWeight - previousWeight.current;
      const MIN_PIECE_WEIGHT = 2.0;

      if (weightChange > MIN_PIECE_WEIGHT && currentWeight > MIN_PIECE_WEIGHT) {
        const pcsCol = currentColumnPair.current * 2;
        const pcsIndex = pcsCol * 20 + currentRowIndex.current;

        if (pcsIndex < carcusPieces.length) {
          isCountingEnabled.current = false;

          setCarcusPieces((prev) => {
            const newPieces = [...prev];
            newPieces[pcsIndex].pcs += 1;
            return newPieces;
          });

          ToastAndroid.show(
            `✓ Added 1 piece (${currentWeight.toFixed(1)}kg)`,
            ToastAndroid.SHORT,
          );

          previousWeight.current = currentWeight;

          setTimeout(() => {
            isCountingEnabled.current = true;
          }, 2000);
        }
      } else if (weightChange < -MIN_PIECE_WEIGHT) {
        const pcsCol = currentColumnPair.current * 2;
        const pcsIndex = pcsCol * 20 + currentRowIndex.current;

        if (pcsIndex < carcusPieces.length) {
          isCountingEnabled.current = false;

          setCarcusPieces((prev) => {
            const newPieces = [...prev];
            if (newPieces[pcsIndex].pcs > 0) {
              newPieces[pcsIndex].pcs -= 1;
              ToastAndroid.show(
                `✓ Removed 1 piece (${Math.abs(weightChange).toFixed(1)}kg)`,
                ToastAndroid.SHORT,
              );
              previousWeight.current = currentWeight;
            }
            return newPieces;
          });

          setTimeout(() => {
            isCountingEnabled.current = true;
          }, 2000);
        }
      }

      if (currentWeight <= 0.1) {
        if (waitingForZero) {
          setWaitingForZero(false);
          setCanCaptureWeight(false);
        }
        previousWeight.current = 0;
        weightHistory.current = [];
        isCountingEnabled.current = true;
      } else {
        if (!canCaptureWeight && !waitingForZero) {
          setCanCaptureWeight(true);
        }
      }
    }

    return () => {
      if (settleTimeout.current) clearTimeout(settleTimeout.current);
    };
  }, [scaleData, carcusPieces]);

  // Calculate totals
  const totalPieces = carcusPieces.reduce((acc, p) => acc + p.pcs, 0);
  const totalWeight = carcusPieces
    .reduce((acc, p) => acc + parseFloat(p.weight || 0), 0)
    .toFixed(2);
  const averageWeight =
    totalPieces > 0 ? (totalWeight / totalPieces).toFixed(2) : 0.0;
  const weights = carcusPieces
    .map((p) => parseFloat(p.weight))
    .filter((w) => w > 0);
  const heaviestCarcus =
    weights.length > 0 ? Math.max(...weights).toFixed(2) : 0.0;
  const lightestCarcus =
    weights.length > 0 ? Math.min(...weights).toFixed(2) : 0.0;

  // FIXED: Check if any weight has been captured
  const hasCapturedWeights = useMemo(() => {
    return carcusPieces.some((piece) => piece.weight > 0);
  }, [carcusPieces]);

  // Field collection data - IMPORTANT: Use supplier for Firestore
  const fieldCollectionData = useMemo(
    () => ({
      clerk: {
        id: user?.clerkId || "",
        name: `${user?.fName || ""} ${user?.lName || ""}`.trim() || "Unknown",
      },
      supplier: supplier,
      destination: {
        id: destinationId,
        name: destinationName,
      },
      carcasType: {
        id: carcasTypeId,
        name: carcasTypeName,
      },
      batchCode: batchCode,
      tagId: tagId,
      ageMonths: parseInt(ageMonths, 10) || 0,
      timestamp: new Date().toISOString(),
    }),
    [
      user,
      supplier,
      destinationId,
      destinationName,
      batchCode,
      carcasTypeId,
      carcasTypeName,
      tagId,
      ageMonths,
    ],
  );

  // === FETCH PREVIOUS RECORDS ===
  useEffect(() => {
    const fetchRecords = async () => {
      let allRecords = [...collections];
      try {
        const networkState = await Network.getNetworkStateAsync();
        if (networkState.isConnected && BusinessId) {
          const fieldCollectionsRef = collection(
            db,
            `Businesses/${BusinessId}/FieldCollections`,
          );
          const q = query(fieldCollectionsRef, orderBy("timestamp", "desc"));
          const snapshot = await getDocs(q);
          const firestoreRecords = snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
          }));
          allRecords = [
            ...collections,
            ...firestoreRecords.filter(
              (fr) => !collections.some((cr) => cr.id === fr.id),
            ),
          ];
        }
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const prevRecords = allRecords
          .filter(
            (record) =>
              record.tagId !== tagId &&
              record.carcasType &&
              record.weights &&
              Array.isArray(record.weights),
          )
          .flatMap((record) => {
            if (!record.weights || !Array.isArray(record.weights)) return [];
            return record.weights.map((w, index) => {
              const recordDate = new Date(record.timestamp);
              return recordDate >= today && recordDate < tomorrow
                ? {
                    id: `${record.id}-${index}`,
                    tagId: record.tagId || "N/A",
                    label: record.carcasType?.name || "Unknown",
                    batchCode: record.batchCode || "N/A",
                    supplier: record.supplier?.name || "N/A",
                    destination: record.destination?.name || "N/A",
                    ageMonths:
                      record.ageMonths !== undefined ? record.ageMonths : 0,
                    weight: parseFloat(w.weight || 0).toFixed(2),
                    timestamp: record.timestamp || new Date().toISOString(),
                  }
                : null;
            });
          })
          .filter(Boolean);
        setPreviousRecords((prev) => {
          const existingIds = new Set(prev.map((r) => r.id));
          const newRecords = prevRecords.filter((r) => !existingIds.has(r.id));
          return [...prev, ...newRecords].sort(
            (a, b) => new Date(b.timestamp) - new Date(a.timestamp),
          );
        });
      } catch (error) {
        console.error("Error fetching records:", error);
        ToastAndroid.show(
          "Error fetching previous records",
          ToastAndroid.SHORT,
        );
      }
    };
    fetchRecords();
  }, [BusinessId, collections, tagId]);

  // === HANDLE CELL PRESS (SELECT PAIR) ===
  const handleCellPress = (rowIndex, colIndex) => {
    const pairIndex = Math.floor(colIndex / 2);
    const key = `${rowIndex}-${pairIndex}`;
    setSelectedPairIndices((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  };

  useEffect(() => {
    setShowDelete(selectedPairIndices.length > 0);
  }, [selectedPairIndices]);

  const handleDelete = () => {
    if (selectedPairIndices.length > 0) {
      setCarcusPieces((prev) => {
        const newPieces = [...prev];
        selectedPairIndices.forEach((key) => {
          const [row, pair] = key.split("-").map(Number);
          const pcsCol = pair * 2;
          const weightCol = pcsCol + 1;
          const pcsIndex = pcsCol * 20 + row;
          const weightIndex = weightCol * 20 + row;

          if (pcsIndex < newPieces.length) {
            newPieces[pcsIndex] = { pcs: 0, weight: 0 };
          }
          if (weightIndex < newPieces.length) {
            newPieces[weightIndex] = { pcs: 0, weight: 0 };
          }
        });
        return newPieces;
      });

      selectedPairIndices.forEach((key) => {
        const [row, pair] = key.split("-").map(Number);
        if (
          row === currentRowIndex.current &&
          pair === currentColumnPair.current
        ) {
          currentRowIndex.current = 0;
          currentColumnPair.current = 0;
        }
      });

      setSelectedPairIndices([]);
      setShowDelete(false);
      ToastAndroid.show(
        `${selectedPairIndices.length} pair(s) cleared.`,
        ToastAndroid.SHORT,
      );
    }
  };

  // === RENDER GRID ===
  const renderedCarcusPieces = useMemo(() => {
    const rows = [];
    for (let row = 0; row < 20; row++) {
      const isCurrentRow = row === currentRowIndex.current;

      rows.push(
        <View key={`row-${row}`} style={styles.tableRow}>
          {Array.from({ length: TOTAL_COLUMNS }).map((_, colIndex) => {
            const pairIndex = Math.floor(colIndex / 2);
            const isPcsColumn = colIndex % 2 === 0;
            const isWeightColumn = colIndex % 2 === 1;
            const index = colIndex * 20 + row;
            const item = carcusPieces[index] || { pcs: 0, weight: 0 };
            const isActivePcs =
              isCurrentRow &&
              pairIndex === currentColumnPair.current &&
              isPcsColumn;
            const isActiveWeight =
              isCurrentRow &&
              pairIndex === currentColumnPair.current &&
              isWeightColumn;
            const selectionKey = `${row}-${pairIndex}`;
            const isHighlighted = selectedPairIndices.includes(selectionKey);

            return (
              <TouchableOpacity
                key={`cell-${colIndex}`}
                onPress={() => handleCellPress(row, colIndex)}
                style={[
                  styles.squareCell,
                  isPcsColumn ? styles.pcsCell : styles.weightCell,
                  isHighlighted && styles.highlightedCell,
                  isActivePcs && styles.activePcs,
                  isActiveWeight && styles.activeWeight,
                ]}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.cellText,
                    isPcsColumn && item.pcs > 0 && styles.filledText,
                    isWeightColumn && item.weight > 0 && styles.filledText,
                  ]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.5}
                >
                  {isPcsColumn
                    ? item.pcs > 0
                      ? item.pcs
                      : ""
                    : item.weight > 0
                      ? `${item.weight}`
                      : ""}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>,
      );
    }
    return rows;
  }, [
    carcusPieces,
    selectedPairIndices,
    currentRowIndex.current,
    currentColumnPair.current,
  ]);

  const renderedPreviousRecords = useMemo(() => {
    return previousRecords.map((item, index) => (
      <View
        key={item.id || index}
        style={[styles.tableRow, { backgroundColor: "#f9f9f9" }]}
      >
        <Text style={[styles.tableCell, { minWidth: 40 }]}>{index + 1}</Text>
        <Text style={[styles.tableCell, { minWidth: 70 }]}>
          {item.tagId || "N/A"}
        </Text>
        <Text style={[styles.tableCell, { minWidth: 100 }]}>
          {item.label || "N/A"}
        </Text>
        <Text style={[styles.tableCell, { minWidth: 80 }]}>
          {item.ageMonths ? `${item.ageMonths} months` : "N/A"}
        </Text>
        <Text style={[styles.tableCell, { minWidth: 100 }]}>
          {item.supplier || "N/A"}
        </Text>
        <Text style={[styles.tableCell, { minWidth: 60 }]}>
          {item.weight || "0.00"}
        </Text>
        <Text style={[styles.tableCell, { minWidth: 90 }]}>
          {new Date(item.timestamp).toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
          })}
        </Text>
        <Text style={[styles.tableCell, { minWidth: 70 }]}>
          {new Date(item.timestamp).toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "numeric",
          })}
        </Text>
      </View>
    ));
  }, [previousRecords]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 100);
  }, []);

  const parseBluetoothData = (data) => {
    let numericValue = null;
    if (typeof data === "string") {
      try {
        const decodedData = atob(data);
        const match = decodedData.match(/-?\d+(\.\d+)?/);
        if (match) numericValue = parseFloat(match[0]);
      } catch {
        const match = data.match(/-?\d+(\.\d+)?/);
        if (match) numericValue = parseFloat(match[0]);
      }
    } else if (typeof data === "number") {
      numericValue = data;
    }
    return numericValue !== null && !isNaN(numericValue)
      ? { reading: numericValue.toFixed(2) + "kg", isStable: true }
      : { reading: null, isStable: true };
  };

  const handleSwitchBt = async () => {
    const printer = store.getState().settings.printerAddress;
    try {
      await connectToDevice(printer);
      ToastAndroid.show("Printer connected successfully", ToastAndroid.SHORT);
    } catch {
      ToastAndroid.show("Failed to connect to printer", ToastAndroid.SHORT);
    }
  };

  // Receipt printing - Updated to show Client instead of Supplier
  const showPrinterReceipt = async () => {
    try {
      console.log("Printing receipt with:", {
        clientName,
        destinationName,
        batchCode,
        carcasTypeName,
      });

      const batch = batchCode;
      const client = clientName;
      const destination = destinationName;
      const carcasType = carcasTypeName;
      const server = fieldCollectionData.clerk.name || "Unknown";
      const separator = "-----------------------------\n";

      let receiptData = "";

      // Printer initialization
      receiptData += "\x1B\x40\x1B\x33\x18\x1B\x21\x30\x1B\x61\x01";
      receiptData += "CARCAS WEIGHING RECEIPT\n";
      receiptData += "\x1B\x21\x00\x1B\x61\x00\n";

      // Batch Code
      receiptData += `Batch: ${batch.padEnd(22)}\n`;

      // Date and time
      receiptData += `Day: ${new Date()
        .toLocaleDateString("en-US", { weekday: "long" })
        .padEnd(22)}\n`;
      receiptData += `Date: ${new Date().toLocaleDateString().padEnd(22)}\n`;
      receiptData += `Time: ${new Date()
        .toLocaleTimeString()
        .slice(0, 8)
        .padEnd(22)}\n`;

      receiptData += separator;

      // Client and Destination - CHANGED HERE
      receiptData += `Client: ${client.slice(0, 22).padEnd(22)}\n`;
      receiptData += `Destination: ${destination.slice(0, 22).padEnd(22)}\n`;

      receiptData += separator;

      // Carcas Profile
      receiptData += "CARCAS PROFILE\n";
      receiptData += `Type: ${carcasType.slice(0, 22).padEnd(22)}\n`;

      receiptData += separator;

      // SUMMARY SECTION
      receiptData += "\x1B\x21\x10PIECES AND WEIGHTS\x1B\x21\x00\n";
      receiptData += separator;

      // Total Pieces and Total Weight
      receiptData += `Total Pieces: ${totalPieces.toString().padStart(10)}\n`;
      receiptData += `Total Weight: ${totalWeight.padStart(10)} kg\n`;

      receiptData += separator;

      // Average Weight
      receiptData += `Average  Weight: ${averageWeight.padStart(12)} kg\n`;

      // Lightest and Heaviest Carcus
      receiptData += `Lightest Weight: ${lightestCarcus.padStart(12)} kg\n`;
      receiptData += `Heaviest Weight: ${heaviestCarcus.padStart(12)} kg\n`;

      receiptData += separator;

      // Server information
      receiptData += "\x1B\x21\x00\n";
      receiptData += `Served by: ${server.slice(0, 20).padEnd(20)}\n\n`;

      // Thank you message
      receiptData += "\x1B\x61\x01Thank you for your business!\n";
      receiptData += "==============================\n";
      receiptData += "\x1B\x61\x00\n\n\n\x1D\x56\x00";

      const printerAddress = store.getState().settings.printerAddress;
      await writeToDevice(printerAddress, receiptData, "ascii");
      ToastAndroid.show("Receipt printed successfully", ToastAndroid.SHORT);
    } catch (error) {
      console.error("Print error:", error);
      ToastAndroid.show("Failed to print receipt", ToastAndroid.SHORT);
    }
  };

  // FIXED: Save record function - now saves supplier object properly
  const handleSaveRecord = async () => {
    setLoading(true);

    // Check if any weights have been captured
    if (!hasCapturedWeights) {
      ToastAndroid.show(
        "Please capture at least one weight before saving",
        ToastAndroid.SHORT,
      );
      setLoading(false);
      return;
    }

    try {
      const newRecord = {
        ...fieldCollectionData,
        batchCode: batchCode,
        supplier: supplier,
        destination: {
          id: destinationId,
          name: destinationName,
        },
        carcasType: {
          id: carcasTypeId,
          name: carcasTypeName,
        },
        products: carcusPieces
          .filter((item) => item.weight > 0)
          .map((item, index) => ({
            name: `Piece ${index + 1}`,
            value: index,
            weight: parseFloat(item.weight || 0).toFixed(2),
            timestamp: new Date().toISOString(),
          })),
        weight: totalWeight,
        weights: carcusPieces
          .filter((item) => item.weight > 0)
          .map((item) => ({
            weight: parseFloat(item.weight) || 0,
            timestamp: new Date().toISOString(),
          })),
        totalWeight,
        totalPieces,
        averageWeight,
        heaviestCarcus,
        lightestCarcus,
      };

      console.log("Saving to Firestore with supplier:", newRecord.supplier);

      const networkState = await Network.getNetworkStateAsync();
      if (networkState.isConnected) {
        // Save to Firestore (admin side)
        const fieldCollectionsRef = collection(
          db,
          `Businesses/${BusinessId}/FieldCollections`,
        );
        const docRef = await addDoc(fieldCollectionsRef, newRecord);

        console.log("Saved to Firestore with ID:", docRef.id);

        // Add to local state for display
        const newPrevRecords = carcusPieces
          .filter((item) => item.weight > 0)
          .map((item, index) => ({
            id: `${docRef.id}-${index}-${Date.now()}`,
            tagId: newRecord.tagId || "N/A",
            label: newRecord.carcasType?.name || "Unknown",
            batchCode: newRecord.batchCode || "N/A",
            supplier: newRecord.supplier?.name || "N/A",
            destination: newRecord.destination?.name || "N/A",
            ageMonths: newRecord.ageMonths || 0,
            weight: parseFloat(item.weight || 0).toFixed(2),
            timestamp: new Date().toISOString(),
            parentId: docRef.id,
          }));
        setPreviousRecords((prev) =>
          [...newPrevRecords, ...prev].sort(
            (a, b) => new Date(b.timestamp) - new Date(a.timestamp),
          ),
        );

        // Also save locally for offline access
        store.dispatch(
          setCollections([...collections, { ...newRecord, id: docRef.id }]),
        );

        resetForm();
        ToastAndroid.show(
          "Record saved to admin database!",
          ToastAndroid.SHORT,
        );
      } else {
        // Save locally when offline
        store.dispatch(setCollections([...collections, newRecord]));
        const newPrevRecords = carcusPieces
          .filter((item) => item.weight > 0)
          .map((item, index) => ({
            id: `${Date.now()}-${index}`,
            tagId: newRecord.tagId || "N/A",
            label: newRecord.carcasType?.name || "Unknown",
            batchCode: newRecord.batchCode || "N/A",
            supplier: newRecord.supplier?.name || "N/A",
            destination: newRecord.destination?.name || "N/A",
            ageMonths: newRecord.ageMonths || 0,
            weight: parseFloat(item.weight || 0).toFixed(2),
            timestamp: new Date().toISOString(),
          }));
        setPreviousRecords((prev) =>
          [...newPrevRecords, ...prev].sort(
            (a, b) => new Date(b.timestamp) - new Date(a.timestamp),
          ),
        );
        resetForm();
        ToastAndroid.show("Record saved locally (offline)", ToastAndroid.SHORT);
      }
      setLoading(false);
    } catch (error) {
      console.error("Error saving record:", error);
      ToastAndroid.show(
        "Error saving record: " + error.message,
        ToastAndroid.SHORT,
      );
      setLoading(false);
    }
  };

  const resetForm = () => {
    setCarcusPieces(
      Array.from({ length: TOTAL_COLUMNS * 20 }, () => ({ pcs: 0, weight: 0 })),
    );
    currentRowIndex.current = 0;
    currentColumnPair.current = 0;
    setWaitingForZero(true);
    setCanCaptureWeight(false);
    previousWeight.current = 0;
    weightHistory.current = [];
    isCountingEnabled.current = true;
  };

  const handleCapture = () => {
    if (!scaleData.reading || !canCaptureWeight) {
      ToastAndroid.show(
        waitingForZero
          ? "Place items to count"
          : "Remove items before capturing",
        ToastAndroid.SHORT,
      );
      return;
    }

    const currentWeight = parseFloat(scaleData.reading.replace("kg", "")) || 0;
    const pcsCol = currentColumnPair.current * 2;
    const weightCol = pcsCol + 1;

    if (pcsCol % 2 !== 0 || weightCol >= TOTAL_COLUMNS) return;

    const pcsIndex = pcsCol * 20 + currentRowIndex.current;
    const weightIndex = weightCol * 20 + currentRowIndex.current;

    setCarcusPieces((prev) => {
      const newPieces = [...prev];
      const pcsCount = newPieces[pcsIndex]?.pcs || 0;
      if (pcsCount > 0) {
        newPieces[weightIndex].weight = currentWeight.toFixed(2);
      }
      return newPieces;
    });

    currentRowIndex.current += 1;
    if (currentRowIndex.current >= 20) {
      currentRowIndex.current = 0;
      currentColumnPair.current = Math.min(
        currentColumnPair.current + 1,
        TOTAL_PAIRS - 1,
      );
    }

    setWaitingForZero(true);
    setCanCaptureWeight(false);
    previousWeight.current = 0;
    weightHistory.current = [];
    isCountingEnabled.current = true;

    ToastAndroid.show(
      "✓ Weight captured. Remove all items to start next batch.",
      ToastAndroid.SHORT,
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Header refresh={refreshing} handleClick={onRefresh} />

        <ScrollView
          style={styles.mainScrollView}
          showsVerticalScrollIndicator={true}
          contentContainerStyle={styles.scrollContent}
        >
          {/* Bluetooth Display Section */}
          <View
            style={[
              styles.display,
              { backgroundColor: scaleData.isStable ? "green" : "red" },
            ]}
          >
            <View style={styles.data}>
              <Text style={styles.textBold}>Connected Device:</Text>
              <Text style={styles.textRegular}>
                {receivedData ? "Connected" : "Disconnected"}
              </Text>
              <Text style={styles.textBold}>Scale Stability:</Text>
              <Text style={styles.textRegular}>
                {scaleData.isStable ? "Stable" : "Unstable"}
              </Text>
            </View>
            <View>
              <Text style={styles.textWeight}>
                {scaleData.reading || "0.00 Kg"}
              </Text>
            </View>
          </View>

          {/* Action Buttons */}
          <View style={styles.buttonContainer}>
            <TouchableOpacity
              style={[
                styles.button,
                { backgroundColor: canCaptureWeight ? "#F2F2F2" : "#ccc" },
              ]}
              onPress={handleCapture}
              disabled={!canCaptureWeight}
            >
              <Text
                style={[
                  styles.textButton,
                  { color: canCaptureWeight ? "#000" : "#666" },
                ]}
              >
                Capture
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, { backgroundColor: "#F2F2F2" }]}
              onPress={() => setModalVisible(true)}
            >
              <Text style={styles.textButton}>Print Receipt</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.button,
                {
                  backgroundColor: loading
                    ? "#ccc"
                    : hasCapturedWeights
                      ? "green"
                      : "#ccc",
                },
              ]}
              onPress={handleSaveRecord}
              disabled={loading || !hasCapturedWeights}
            >
              {loading ? (
                <ActivityIndicator color="#00FF00" />
              ) : (
                <Text
                  style={[
                    styles.textButton,
                    { color: hasCapturedWeights ? "#fff" : "#666" },
                  ]}
                >
                  Save Record{" "}
                  {hasCapturedWeights ? `(${totalPieces} pieces)` : ""}
                </Text>
              )}
            </TouchableOpacity>

            {showDelete && (
              <TouchableOpacity
                style={[styles.deleteButton, { backgroundColor: "red" }]}
                onPress={handleDelete}
              >
                <Text style={[styles.textButton, { color: "#fff" }]}>
                  Delete
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Summary Section */}
          <View style={styles.animalSection}>
            <Text style={styles.sectionHeader}>Summary</Text>
            <View style={styles.summaryDetails}>
              <View style={styles.summaryLeft}>
                <View style={styles.boxYellow}>
                  <Text style={styles.summaryText}>
                    Total Pieces: {totalPieces}
                  </Text>
                </View>
                <View style={styles.boxYellow}>
                  <Text style={styles.summaryText}>
                    Total Weight: {totalWeight} kg
                  </Text>
                </View>
                <View style={styles.boxYellow}>
                  <Text style={styles.summaryText}>
                    Average Weight: {averageWeight} kg
                  </Text>
                </View>
              </View>
              <View style={styles.summaryRight}>
                <View style={styles.boxGreen}>
                  <Text style={styles.summaryText}>
                    Heaviest Carcas: {heaviestCarcus} kg
                  </Text>
                </View>
                <View style={styles.boxLightRed}>
                  <Text style={styles.summaryText}>
                    Lightest Carcas: {lightestCarcus} kg
                  </Text>
                </View>
              </View>
            </View>

            {/* Details Section */}
            <Text style={styles.sectionHeader}>Carcas Details</Text>
            <View style={styles.animalDetails}>
              <Text style={styles.detailText}>Batch: {batchCode}</Text>
              <Text style={styles.detailText}>Client: {clientName}</Text>
              <Text style={styles.detailText}>
                Destination: {destinationName}
              </Text>
              <Text style={styles.detailText}>Type: {carcasTypeName}</Text>
            </View>

            {/* Weight Records Section */}
            <Text style={styles.sectionHeader}>Carcas Weight Records</Text>

            {/* Horizontal Scroll for Weight Grid */}
            <View style={styles.tableContainer}>
              <ScrollView horizontal showsHorizontalScrollIndicator={true}>
                <View>
                  <View style={styles.tableHeaderRow}>
                    {Array.from({ length: TOTAL_PAIRS }).map((_, i) => (
                      <React.Fragment key={`h-${i}`}>
                        <View style={[styles.squareCell, styles.headerPcs]}>
                          <Text style={styles.headerText}>pcs</Text>
                        </View>
                        <View style={[styles.squareCell, styles.headerWeight]}>
                          <Text style={styles.headerText}>weight(kgs)</Text>
                        </View>
                      </React.Fragment>
                    ))}
                  </View>

                  <ScrollView
                    style={styles.gridScroll}
                    showsVerticalScrollIndicator={true}
                  >
                    {renderedCarcusPieces}

                    {carcusPieces.some((p) => p.weight > 0) && (
                      <View style={styles.totalRow}>
                        {Array.from({ length: TOTAL_COLUMNS - 1 }).map(
                          (_, i) => (
                            <View key={`t-${i}`} style={styles.squareCell} />
                          ),
                        )}
                        <View
                          style={[
                            styles.squareCell,
                            { justifyContent: "center" },
                          ]}
                        >
                          <Text style={styles.totalText}>
                            Total: {totalWeight} kg
                          </Text>
                        </View>
                      </View>
                    )}
                  </ScrollView>
                </View>
              </ScrollView>
            </View>

            {/* Previous Records */}
            {previousRecords.length > 0 && (
              <>
                <View style={styles.tableRow}>
                  <Text
                    style={[
                      styles.tableHeader,
                      {
                        minWidth: TOTAL_COLUMNS * CELL_SIZE,
                        backgroundColor: "#e0e0e0",
                      },
                    ]}
                  >
                    Previous Records (Today)
                  </Text>
                </View>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={true}
                  style={styles.prevRecordsScroll}
                >
                  <View>{renderedPreviousRecords}</View>
                </ScrollView>
              </>
            )}
          </View>
        </ScrollView>

        {/* Print Modal */}
        <Modal
          animationType="slide"
          transparent={true}
          visible={modalVisible}
          onRequestClose={() => setModalVisible(false)}
        >
          <View style={styles.centeredView}>
            <View style={styles.modalView}>
              <View style={styles.modalNav}>
                <Text style={styles.touchableText}>Print Receipt</Text>
              </View>
              <View style={styles.modalContent}>
                <TouchableOpacity
                  style={[styles.button, { borderRadius: 20 }]}
                  onPress={handleSwitchBt}
                >
                  <AntDesign name="printer" size={34} color="blue" />
                  <Text style={styles.textButton}>Reconnect printer</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.button}
                  onPress={async () => {
                    await showPrinterReceipt();
                    setModalVisible(false);
                  }}
                >
                  <Text style={styles.textButton}>Print</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.button}
                  onPress={() => setModalVisible(false)}
                >
                  <Text style={styles.textButton}>Close</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#F9F9F9",
    paddingTop: Platform.OS === "android" ? 25 : 0,
  },
  container: {
    flex: 1,
    backgroundColor: "#F9F9F9",
  },
  mainScrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 20,
    alignItems: "center",
  },
  display: {
    height: 100,
    width: screenWidth * 0.9,
    borderRadius: 10,
    flexDirection: "row",
    padding: 10,
    justifyContent: "space-between",
    alignItems: "center",
    marginVertical: 10,
  },
  data: {
    flex: 1,
  },
  buttonContainer: {
    width: screenWidth * 0.9,
  },
  button: {
    width: "100%",
    paddingVertical: 12,
    alignItems: "center",
    marginVertical: 5,
    borderRadius: 50,
  },
  deleteButton: {
    width: "100%",
    paddingVertical: 12,
    alignItems: "center",
    marginVertical: 5,
    borderRadius: 50,
  },
  textButton: {
    fontFamily: "Poppins-Regular",
    fontSize: 16,
  },
  animalSection: {
    backgroundColor: "#F2F2F2",
    borderRadius: 10,
    width: screenWidth * 0.95,
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 5,
    marginVertical: 10,
  },
  sectionHeader: {
    fontFamily: "Poppins-Bold",
    fontSize: 20,
    textAlign: "center",
    marginBottom: 10,
  },
  animalDetails: {
    width: "100%",
    flexDirection: "row",
    justifyContent: "space-between",
    flexWrap: "wrap",
    paddingHorizontal: 10,
    marginBottom: 10,
  },
  summaryDetails: {
    width: "100%",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    marginBottom: 10,
  },
  summaryLeft: {
    flex: 1,
    alignItems: "flex-start",
    marginRight: 5,
  },
  summaryRight: {
    flex: 1,
    alignItems: "flex-end",
    marginLeft: 5,
  },
  boxYellow: {
    backgroundColor: "yellow",
    padding: 5,
    borderRadius: 5,
    width: 150,
    alignItems: "center",
    marginBottom: 5,
  },
  boxGreen: {
    backgroundColor: "green",
    padding: 5,
    borderRadius: 5,
    width: 150,
    alignItems: "center",
    marginBottom: 5,
  },
  boxLightRed: {
    backgroundColor: "#FFB6C1",
    padding: 5,
    borderRadius: 5,
    width: 150,
    alignItems: "center",
  },
  summaryText: {
    fontFamily: "Poppins-Regular",
    fontSize: 12,
    color: "black",
    textAlign: "center",
  },
  detailText: {
    fontFamily: "Poppins-Regular",
    fontSize: Math.min(14, Math.max(10, screenWidth * 0.03)),
    flex: 1,
    textAlign: "center",
    marginBottom: 5,
    color: "#333",
    fontWeight: "500",
  },
  tableContainer: {
    backgroundColor: "white",
    width: screenWidth * 0.95,
    borderRadius: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#ddd",
  },
  gridScroll: {
    maxHeight: 400,
  },
  tableHeaderRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderColor: "#ddd",
    backgroundColor: "#f1f1f1",
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderColor: "#ddd",
    backgroundColor: "#fff",
  },
  squareCell: {
    width: CELL_SIZE,
    height: CELL_SIZE,
    justifyContent: "center",
    alignItems: "center",
    borderRightWidth: 1,
    borderColor: "#ddd",
  },
  pcsCell: { backgroundColor: "darkgray" },
  weightCell: { backgroundColor: "lightblue" },
  highlightedCell: { backgroundColor: "yellow" },
  activePcs: { backgroundColor: "#0066cc" },
  activeWeight: { backgroundColor: "#0066cc" },
  cellText: {
    fontFamily: "Poppins-Regular",
    fontSize: 9,
    color: "black",
    textAlign: "center",
  },
  filledText: {
    fontWeight: "bold",
    color: "red",
  },
  headerPcs: { backgroundColor: "grey" },
  headerWeight: { backgroundColor: "lightblue" },
  headerText: {
    fontFamily: "Poppins-Bold",
    fontSize: 9,
    color: "red",
    textAlign: "center",
  },
  totalRow: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderColor: "#ddd",
    backgroundColor: "#f9f9f9",
  },
  totalText: {
    fontFamily: "Poppins-Bold",
    fontSize: 11,
    color: "black",
    textAlign: "center",
  },

  // Previous Records Styles
  prevRecordsScroll: {
    maxHeight: 200,
  },
  tableCell: {
    fontFamily: "Poppins-Regular",
    fontSize: 9,
    padding: 5,
    textAlign: "center",
    borderRightWidth: 1,
    borderColor: "#ddd",
  },
  tableHeader: {
    fontFamily: "Poppins-Bold",
    fontSize: 11,
    padding: 8,
    textAlign: "left",
  },

  // Text Styles
  textBold: {
    fontFamily: "Poppins-Bold",
    fontSize: Math.min(16, Math.max(12, screenWidth * 0.035)),
    color: "white",
  },
  textRegular: {
    fontFamily: "Poppins-Regular",
    fontSize: Math.min(16, Math.max(12, screenWidth * 0.035)),
    color: "white",
  },
  textWeight: {
    fontFamily: "Poppins-Regular",
    fontSize: Math.min(24, Math.max(18, screenWidth * 0.06)),
    color: "white",
  },

  // Modal Styles
  centeredView: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  modalView: {
    margin: 20,
    backgroundColor: "white",
    borderRadius: 20,
    padding: 35,
    width: screenWidth * 0.9,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  modalNav: {
    width: "100%",
    alignItems: "center",
    marginBottom: 20,
  },
  touchableText: {
    fontFamily: "Poppins-Bold",
    fontSize: 20,
  },
  modalContent: {
    width: "100%",
    alignItems: "center",
  },
});

export default RecordPage;

