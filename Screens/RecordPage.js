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

const { width: screenWidth } = Dimensions.get("window");

// Fixed cell size
const CELL_SIZE = 50;

// Calculate how many columns fit on screen + extra to fill space
const MIN_COLUMNS = 6; // At least 6 pairs (pcs + weight)
const COLUMNS_PER_SCREEN = Math.floor(screenWidth / CELL_SIZE);
const TOTAL_PAIRS = Math.max(
  MIN_COLUMNS,
  Math.ceil(COLUMNS_PER_SCREEN / 2) + 2
); // Extra columns
const TOTAL_COLUMNS = TOTAL_PAIRS * 2; // pcs + weight

const RecordPage = ({ route, navigation }) => {
  const { location, animalType, tagId, ageMonths } = route.params || {};
  const collections = useSelector((state) => state.settings.collections) || [];
  const { BusinessId, user } = useSelector((state) => state.settings) || {};

  const [modalVisible, setModalVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [carcusPieces, setCarcusPieces] = useState(
    Array.from({ length: TOTAL_COLUMNS * 20 }, () => ({
      pcs: 0,
      weight: 0,
      captured: false,
    }))
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
  const lastStableTime = useRef(0);
  const lastAddTime = useRef(0);
  const lastCapturedWeight = useRef(0);

  // === INSTANT BLUETOOTH DATA PARSING & UPDATE ===
  useEffect(() => {
    if (receivedData) {
      const parsedData = parseBluetoothData(receivedData);
      if (parsedData.reading !== null) {
        setScaleData(parsedData);
      }
    }
  }, [receivedData]);

  // === WEIGHT STABILITY & ZERO DETECTION ===
  useEffect(() => {
    if (scaleData.isStable && scaleData.reading !== null) {
      const currentWeight =
        parseFloat(scaleData.reading.replace("kg", "")) || 0;

      if (waitingForZero && currentWeight <= 0.1) {
        setWaitingForZero(false);
        setCanCaptureWeight(false);
        lastStableTime.current = 0;
        lastAddTime.current = 0;
      } else if (!waitingForZero && currentWeight > 0.1) {
        setCanCaptureWeight(true);
        lastStableTime.current = Date.now();
      }

      previousWeight.current = currentWeight;
    }
  }, [scaleData, waitingForZero]);

  // === AUTO-ADD PIECES: First immediately, then every 3s on stable increase ===
  useEffect(() => {
    if (!canCaptureWeight || !scaleData.isStable || waitingForZero) return;

    const now = Date.now();
    const currentWeight = parseFloat(scaleData.reading.replace("kg", "")) || 0;
    if (currentWeight <= 0.1) return;

    const pcsCol = currentColumnPair.current * 2;
    const pcsIndex = pcsCol * 20 + currentRowIndex.current;
    const currentPcs = carcusPieces[pcsIndex]?.pcs || 0;

    // First piece: add immediately when stable
    if (currentPcs === 0) {
      addPiece(currentWeight, pcsIndex);
      return;
    }

    // Subsequent pieces: every 3s AND weight increased by at least 0.1kg
    if (
      now - lastAddTime.current >= 3000 &&
      currentWeight > lastCapturedWeight.current + 0.1
    ) {
      addPiece(currentWeight, pcsIndex);
    }
  }, [scaleData, canCaptureWeight, waitingForZero]);

  // === DETECT REMOVAL: Decrease pcs if weight drops significantly ===
  useEffect(() => {
    if (!canCaptureWeight || !scaleData.isStable || waitingForZero) return;

    const currentWeight = parseFloat(scaleData.reading.replace("kg", "")) || 0;
    if (currentWeight <= 0.1) return;

    const pcsCol = currentColumnPair.current * 2;
    const pcsIndex = pcsCol * 20 + currentRowIndex.current;
    const currentPcs = carcusPieces[pcsIndex]?.pcs || 0;
    if (currentPcs === 0) return;

    const drop = lastCapturedWeight.current - currentWeight;
    if (drop > 0.15) {
      const piecesRemoved = Math.min(
        currentPcs,
        Math.max(1, Math.floor(drop / 0.2))
      );

      setCarcusPieces((prev) => {
        const newPieces = [...prev];
        newPieces[pcsIndex] = {
          ...newPieces[pcsIndex],
          pcs: currentPcs - piecesRemoved,
        };
        return newPieces;
      });

      lastCapturedWeight.current = currentWeight;
      ToastAndroid.show(
        `${piecesRemoved} piece(s) removed`,
        ToastAndroid.SHORT
      );
    }
  }, [scaleData, canCaptureWeight, waitingForZero, carcusPieces]);

  const addPiece = (currentWeight, pcsIndex) => {
    setCarcusPieces((prev) => {
      const newPieces = [...prev];
      const currentPcs = newPieces[pcsIndex]?.pcs || 0;
      newPieces[pcsIndex] = {
        pcs: currentPcs + 1,
        weight: 0,
        captured: false,
      };
      return newPieces;
    });

    lastAddTime.current = Date.now();
    lastCapturedWeight.current = currentWeight;
  };

  // === HANDLE CAPTURE BUTTON: Capture current stable weight for the box ===
  const handleCapture = () => {
    if (!scaleData.isStable || !scaleData.reading) {
      ToastAndroid.show("Wait for stable weight", ToastAndroid.SHORT);
      return;
    }

    const currentWeight = parseFloat(scaleData.reading.replace("kg", "")) || 0;
    if (currentWeight <= 0.1) {
      ToastAndroid.show("No weight on scale", ToastAndroid.SHORT);
      return;
    }

    const pcsCol = currentColumnPair.current * 2;
    const weightCol = pcsCol + 1;
    const pcsIndex = pcsCol * 20 + currentRowIndex.current;
    const weightIndex = weightCol * 20 + currentRowIndex.current;

    const currentPcs = carcusPieces[pcsIndex]?.pcs || 0;
    if (currentPcs === 0) {
      ToastAndroid.show("No pieces in current box", ToastAndroid.SHORT);
      return;
    }

    setCarcusPieces((prev) => {
      const newPieces = [...prev];
      newPieces[weightIndex] = {
        pcs: 0,
        weight: currentWeight.toFixed(2),
        captured: true,
      };
      return newPieces;
    });

    lastCapturedWeight.current = currentWeight;

    // Move to next box
    currentRowIndex.current += 1;
    if (currentRowIndex.current >= 20) {
      currentRowIndex.current = 0;
      currentColumnPair.current = Math.min(
        currentColumnPair.current + 1,
        TOTAL_PAIRS - 1
      );
    }

    setWaitingForZero(true);
    setCanCaptureWeight(false);
    lastStableTime.current = 0;
    lastAddTime.current = 0;

    ToastAndroid.show("Weight captured. Move to next box.", ToastAndroid.SHORT);
  };

  // === RESET TO ZERO BEFORE STARTING NEW BOX ===
  useEffect(() => {
    if (waitingForZero && scaleData.isStable && scaleData.reading) {
      const currentWeight =
        parseFloat(scaleData.reading.replace("kg", "")) || 0;
      if (currentWeight <= 0.1) {
        setWaitingForZero(false);
        setCanCaptureWeight(true);
        ToastAndroid.show("Ready to weigh next box", ToastAndroid.SHORT);
      }
    }
  }, [scaleData, waitingForZero]);

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

  const fieldCollectionData = useMemo(
    () => ({
      clerk: {
        id: user?.clerkId || "",
        name: `${user?.fName || ""} ${user?.lName || ""}`.trim() || "Unknown",
      },
      location: {
        name: location?.label || "",
      },
      animalType: {
        name: animalType?.label || "",
        id: animalType?.value || "",
      },
      tagId: tagId || "",
      ageMonths: parseInt(ageMonths, 10) || 0,
      timestamp: new Date().toISOString(),
    }),
    [user, location, animalType, tagId, ageMonths]
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
            `Businesses/${BusinessId}/FieldCollections`
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
              (fr) => !collections.some((cr) => cr.id === fr.id)
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
              record.animalType &&
              record.weights &&
              Array.isArray(record.weights)
          )
          .flatMap((record) => {
            if (!record.weights || !Array.isArray(record.weights)) return [];
            return record.weights.map((w, index) => {
              const recordDate = new Date(record.timestamp);
              return recordDate >= today && recordDate < tomorrow
                ? {
                    id: `${record.id}-${index}`,
                    tagId: record.tagId || "N/A",
                    label: record.animalType?.name || "Unknown",
                    ageMonths:
                      record.ageMonths !== undefined ? record.ageMonths : 0,
                    weight: parseFloat(w.weight || 0).toFixed(2),
                    location: record.location?.name || "N/A",
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
            (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
          );
        });
      } catch (error) {
        console.error("Error fetching records:", error);
        ToastAndroid.show(
          "Error fetching previous records",
          ToastAndroid.SHORT
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
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  // Update showDelete whenever selection changes
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
            newPieces[pcsIndex] = { pcs: 0, weight: 0, captured: false };
          }
          if (weightIndex < newPieces.length) {
            newPieces[weightIndex] = { pcs: 0, weight: 0, captured: false };
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
        ToastAndroid.SHORT
      );
    }
  };

  // === RENDER GRID ===
  const renderedCarcusPieces = useMemo(() => {
    const rows = [];
    for (let row = 0; row < 20; row++) {
      const isCurrentRow = row === currentRowIndex.current;

      rows.push(
        <TouchableOpacity
          key={`row-${row}`}
          style={styles.tableRow}
          activeOpacity={1}
        >
          {Array.from({ length: TOTAL_COLUMNS }).map((_, colIndex) => {
            const pairIndex = Math.floor(colIndex / 2);
            const isPcsColumn = colIndex % 2 === 0;
            const isWeightColumn = colIndex % 2 === 1;
            const index = colIndex * 20 + row;
            const item = carcusPieces[index] || {
              pcs: 0,
              weight: 0,
              captured: false,
            };
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
                    isWeightColumn && item.captured && styles.filledText,
                  ]}
                  numberOfLines={1}
                >
                  {isPcsColumn
                    ? item.pcs > 0
                      ? item.pcs
                      : ""
                    : item.captured
                    ? `${item.weight} kgs`
                    : ""}
                </Text>
              </TouchableOpacity>
            );
          })}
        </TouchableOpacity>
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
          {item.location || "N/A"}
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
      : { reading: null, isStable: false };
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

  const showPrinterReceipt = async () => {
    try {
      const location = fieldCollectionData.location.name || "Unknown";
      const animal = fieldCollectionData.animalType.name || "Unknown";
      const tagId = fieldCollectionData.tagId || "N/A";
      const age = fieldCollectionData.ageMonths || "N/A";
      const server = fieldCollectionData.clerk.name || "Unknown";
      const separator = "-----------------------------\n";
      let receiptData = "";
      receiptData += "\x1B\x40\x1B\x33\x18\x1B\x21\x30\x1B\x61\x01";
      receiptData += "Animal Weighing Receipt\n";
      receiptData += "\x1B\x21\x00\x1B\x61\x00\n";
      receiptData += `Day: ${new Date()
        .toLocaleDateString("en-US", { weekday: "long" })
        .padEnd(22)}\n`;
      receiptData += `Date: ${new Date().toLocaleDateString().padEnd(22)}\n`;
      receiptData += `Time: ${new Date()
        .toLocaleTimeString()
        .slice(0, 8)
        .padEnd(22)}\n`;
      receiptData += separator;
      receiptData += `Location: ${location.slice(0, 22).padEnd(22)}\n`;
      receiptData += separator;
      receiptData += "Animal Profile\n";
      receiptData += `Type: ${animal.slice(0, 22).padEnd(22)}\n`;
      receiptData += `TAG ID/NAME: ${tagId.slice(0, 22).padEnd(22)}\n`;
      receiptData +=
        `Age: ${age !== "N/A" ? `${age} months` : "N/A"}`.padEnd(22) + "\n";
      receiptData += separator;
      receiptData += "Weights (kg)\n";
      receiptData += separator;
      carcusPieces
        .filter((item) => item.captured)
        .forEach((item, index) => {
          const wgt = parseFloat(item.weight || 0).toFixed(2);
          receiptData += `Weight ${index + 1}: ${wgt.padStart(10)}\n`;
        });
      receiptData += separator;
      receiptData += `\x1B\x21\x20Total: ${totalWeight.padStart(4)} kg\n`;
      receiptData += "\x1B\x21\x00\n";
      receiptData += `Served by: ${server.slice(0, 20).padEnd(20)}\n\n`;
      receiptData +=
        "\x1B\x61\x01Thank you!\n==========================\n\x1B\x61\x00\n\n\n\x1D\x56\x00";
      const printerAddress = store.getState().settings.printerAddress;
      await writeToDevice(printerAddress, receiptData, "ascii");
      ToastAndroid.show("Receipt printed successfully", ToastAndroid.SHORT);
    } catch {
      ToastAndroid.show("Failed to print receipt", ToastAndroid.SHORT);
    }
  };

  const handleSaveRecord = async () => {
    setLoading(true);
    if (!location || carcusPieces.every((p) => !p.captured)) {
      ToastAndroid.show(
        "Please capture at least one weight",
        ToastAndroid.SHORT
      );
      setLoading(false);
      return;
    }
    try {
      const newRecord = {
        ...fieldCollectionData,
        products: carcusPieces
          .filter((item) => item.captured)
          .map((item, index) => ({
            name: `Piece ${index + 1}`,
            value: index,
            weight: parseFloat(item.weight || 0).toFixed(2),
            timestamp: new Date().toISOString(),
          })),
        weight: totalWeight,
        weights: carcusPieces
          .filter((item) => item.captured)
          .map((item) => ({
            weight: parseFloat(item.weight) || 0,
            timestamp: new Date().toISOString(),
          })),
        totalWeight,
      };
      const networkState = await Network.getNetworkStateAsync();
      if (networkState.isConnected) {
        const fieldCollectionsRef = collection(
          db,
          `Businesses/${BusinessId}/FieldCollections`
        );
        const docRef = await addDoc(fieldCollectionsRef, newRecord);
        const newPrevRecords = carcusPieces
          .filter((item) => item.captured)
          .map((item, index) => ({
            id: `${docRef.id}-${index}-${Date.now()}`,
            tagId: newRecord.tagId || "N/A",
            label: newRecord.animalType?.name || "Unknown",
            ageMonths: newRecord.ageMonths || 0,
            weight: parseFloat(item.weight || 0).toFixed(2),
            location: newRecord.location?.name || "N/A",
            timestamp: new Date().toISOString(),
            parentId: docRef.id,
          }));
        setPreviousRecords((prev) =>
          [...newPrevRecords, ...prev].sort(
            (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
          )
        );
        resetForm();
      } else {
        store.dispatch(setCollections([...collections, newRecord]));
        const newPrevRecords = carcusPieces
          .filter((item) => item.captured)
          .map((item, index) => ({
            id: `${Date.now()}-${index}`,
            tagId: newRecord.tagId || "N/A",
            label: newRecord.animalType?.name || "Unknown",
            ageMonths: newRecord.ageMonths || 0,
            weight: parseFloat(item.weight || 0).toFixed(2),
            location: newRecord.location?.name || "N/A",
            timestamp: new Date().toISOString(),
          }));
        setPreviousRecords((prev) =>
          [...newPrevRecords, ...prev].sort(
            (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
          )
        );
        resetForm();
      }
      setLoading(false);
    } catch (error) {
      ToastAndroid.show("Error saving record.", ToastAndroid.SHORT);
      setLoading(false);
    }
  };

  const resetForm = () => {
    setCarcusPieces(
      Array.from({ length: TOTAL_COLUMNS * 20 }, () => ({
        pcs: 0,
        weight: 0,
        captured: false,
      }))
    );
    currentRowIndex.current = 0;
    currentColumnPair.current = 0;
    setWaitingForZero(true);
    setCanCaptureWeight(false);
    lastStableTime.current = 0;
    lastAddTime.current = 0;
    lastCapturedWeight.current = 0;
  };

  return (
    <View style={styles.container}>
      <Header refresh={refreshing} handleClick={onRefresh} />
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
          <Text style={styles.textBold}>Current Box:</Text>
          <Text style={styles.textRegular}>
            {currentColumnPair.current + 1}, Row {currentRowIndex.current + 1}
          </Text>
        </View>
        <View>
          <Text style={styles.textWeight}>
            {scaleData.reading || "0.00 Kg"}
          </Text>
        </View>
      </View>

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
        style={[styles.button, { backgroundColor: loading ? "#ccc" : "green" }]}
        onPress={handleSaveRecord}
      >
        {loading ? (
          <ActivityIndicator color="#00FF00" />
        ) : (
          <Text style={[styles.textButton, { color: "#fff" }]}>
            Save Record
          </Text>
        )}
      </TouchableOpacity>

      {showDelete && (
        <TouchableOpacity
          style={[styles.deleteButton, { backgroundColor: "red" }]}
          onPress={handleDelete}
        >
          <Text style={[styles.textButton, { color: "#fff" }]}>Delete</Text>
        </TouchableOpacity>
      )}

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
                Heaviest Carcus: {heaviestCarcus} kg
              </Text>
            </View>
            <View style={styles.boxLightRed}>
              <Text style={styles.summaryText}>
                Lightest Carcus: {lightestCarcus} kg
              </Text>
            </View>
          </View>
        </View>

        <Text style={styles.sectionHeader}>Carcus Weight Records</Text>
        <View style={styles.animalDetails}>
          <Text style={styles.detailText}>
            Type: {animalType?.label || "N/A"}
          </Text>
          <Text style={styles.detailText}>TAG ID/NAME: {tagId || "N/A"}</Text>
          <Text style={styles.detailText}>
            Age: {ageMonths ? `${ageMonths} months` : "N/A"}
          </Text>
        </View>

        <ScrollView
          style={[styles.scroll, { maxHeight: 400 }]}
          showsVerticalScrollIndicator={true}
        >
          <ScrollView horizontal={true} showsHorizontalScrollIndicator={true}>
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

              {renderedCarcusPieces}

              {carcusPieces.some((p) => p.captured) && (
                <View style={styles.totalRow}>
                  {Array.from({ length: TOTAL_COLUMNS - 1 }).map((_, i) => (
                    <View key={`t-${i}`} style={styles.squareCell} />
                  ))}
                  <View
                    style={[styles.squareCell, { justifyContent: "center" }]}
                  >
                    <Text style={styles.totalText}>
                      Total: {totalWeight} kg
                    </Text>
                  </View>
                </View>
              )}
            </View>
          </ScrollView>

          {previousRecords.length > 0 && (
            <>
              <View style={styles.tableRow}>
                <Text
                  style={{
                    ...styles.tableHeader,
                    minWidth: TOTAL_COLUMNS * CELL_SIZE,
                    backgroundColor: "#e0e0e0",
                  }}
                >
                  Previous Records (Today)
                </Text>
              </View>
              {renderedPreviousRecords}
            </>
          )}
        </ScrollView>
      </View>

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
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    paddingTop: 10,
    backgroundColor: "#F9F9F9",
  },
  display: {
    height: 100,
    width: screenWidth * 0.9,
    borderRadius: 10,
    flexDirection: "row",
    padding: 10,
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  data: { flex: 1 },
  button: {
    width: screenWidth * 0.9,
    paddingVertical: 12,
    alignItems: "center",
    margin: 10,
    borderRadius: 50,
  },
  deleteButton: {
    width: screenWidth * 0.9,
    paddingVertical: 12,
    alignItems: "center",
    margin: 10,
    borderRadius: 50,
  },
  textButton: { fontFamily: "Poppins-Regular", fontSize: 16 },
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
  summaryLeft: { flex: 1, alignItems: "flex-start", marginRight: 5 },
  summaryRight: { flex: 1, alignItems: "flex-end", marginLeft: 5 },
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
    fontSize: Math.min(16, Math.max(12, screenWidth * 0.035)),
    flex: 1,
    textAlign: "center",
  },
  scroll: {
    backgroundColor: "white",
    width: screenWidth * 0.95,
    borderRadius: 10,
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
  cellText: { fontFamily: "Poppins-Regular", fontSize: 9, color: "black" },
  filledText: { fontWeight: "bold", color: "red" },
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
  totalText: { fontFamily: "Poppins-Bold", fontSize: 11, color: "black" },
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
  centeredView: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 22,
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
  modalNav: { width: "100%", alignItems: "center", marginBottom: 20 },
  touchableText: { fontFamily: "Poppins-Bold", fontSize: 20 },
  modalContent: { width: "100%", alignItems: "center" },
  tableHeader: {
    fontFamily: "Poppins-Bold",
    fontSize: 16,
    color: "#333",
    padding: 10,
  },
  tableCell: {
    fontFamily: "Poppins-Regular",
    fontSize: 12,
    padding: 8,
    textAlign: "center",
  },
});

export default RecordPage;

/*import * as Network from "expo-network";
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
} from "react-native";
import React, { useState, useEffect, useMemo, useCallback } from "react";
import Header from "../Components/Header";
import AntDesign from "@expo/vector-icons/AntDesign";
import {
  addDoc,
  collection,
  getDocs,
  query,
  orderBy,
  deleteDoc,
  doc,
} from "firebase/firestore";
import { db } from "../Database/config";
import { store } from "../store/store";
import { useSelector } from "react-redux";
import { setCollections } from "../store";
import { useBluetooth } from "rn-bluetooth-classic";

const { width: screenWidth } = Dimensions.get("window");

const RecordPage = ({ route, navigation }) => {
  const { location, animalType, tagId, ageMonths } = route.params || {};
  const collections = useSelector((state) => state.settings.collections) || [];
  const { BusinessId, user } = useSelector((state) => state.settings) || {};

  const [modalVisible, setModalVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [products, setProducts] = useState([]);
  const [previousRecords, setPreviousRecords] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const {
    devices,
    connectToDevice,
    receivedData,
    isConnected,
    disconnectDevice,
    writeToDevice,
    readFromDevice,
  } = useBluetooth();
  const [selectedProduct] = useState({
    label: animalType?.label || "Animal",
    price: 0,
    value: animalType?.value || "",
  });

  const [scaleData, setScaleData] = useState({
    reading: null,
    isStable: false,
  });

  const [selectedIndices, setSelectedIndices] = useState([]); // Track multiple selected indices
  const [showDelete, setShowDelete] = useState(false); // Show delete button when records are selected

  useEffect(() => {
    if (receivedData) {
      const parsedData = parseBluetoothData(receivedData);
      if (
        parsedData.reading !== null &&
        JSON.stringify(parsedData) !== JSON.stringify(scaleData)
      ) {
        setScaleData(parsedData);
        console.log("PARSED", parsedData);
        console.log("scaledata:", scaleData);
      }
    }
  }, [receivedData]);

  const fieldCollectionData = useMemo(
    () => ({
      clerk: {
        id: user?.clerkId || "",
        name: `${user?.fName || ""} ${user?.lName || ""}`.trim() || "Unknown",
      },
      location: {
        name: location?.label || "",
        subLocation: "Sub-Location A",
      },
      animalType: {
        name: animalType?.label || "",
        id: animalType?.value || "",
      },
      tagId: tagId || "",
      ageMonths: parseInt(ageMonths, 10) || 0,
      timestamp: new Date().toISOString(),
    }),
    [user, location, animalType, tagId, ageMonths]
  );

  // Fetch and retain only today's records
  useEffect(() => {
    const fetchRecords = async () => {
      let allRecords = [...collections];
      try {
        const networkState = await Network.getNetworkStateAsync();
        if (networkState.isConnected && BusinessId) {
          const fieldCollectionsRef = collection(
            db,
            `Businesses/${BusinessId}/FieldCollections`
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
              (fr) => !collections.some((cr) => cr.id === fr.id)
            ),
          ];
        }
        const today = new Date();
        today.setHours(0, 0, 0, 0); // Start of today
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1); // End of today

        const prevRecords = allRecords
          .filter(
            (record) =>
              record.tagId !== tagId &&
              record.animalType &&
              record.weights &&
              Array.isArray(record.weights)
          )
          .flatMap((record) => {
            if (!record.weights || !Array.isArray(record.weights)) {
              console.warn("Invalid record, missing weights:", record);
              return [];
            }
            return record.weights.map((w, index) => {
              const recordDate = new Date(record.timestamp);
              return recordDate >= today && recordDate < tomorrow
                ? {
                    id: `${record.id}-${index}`, // Unique ID for each weight entry
                    tagId: record.tagId || "N/A",
                    label: record.animalType?.name || "Unknown",
                    ageMonths:
                      record.ageMonths !== undefined ? record.ageMonths : 0,
                    weight: parseFloat(w.weight || 0).toFixed(2),
                    location: record.location?.name || "N/A",
                    timestamp: record.timestamp || new Date().toISOString(),
                    parentId: record.id, // Store parent document ID for deletion
                  }
                : null;
            });
          })
          .filter((record) => record !== null); // Remove null entries for non-today records

        // Merge and sort all records by latest timestamp
        setPreviousRecords((prev) => {
          const existingIds = new Set(prev.map((r) => r.id));
          const newRecords = prevRecords.filter((r) => !existingIds.has(r.id));
          return [...prev, ...newRecords].sort(
            (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
          );
        });
        console.log("Fetched previousRecords length:", previousRecords.length);
        if (prevRecords.length === 0 && allRecords.length > 0) {
          ToastAndroid.show(
            "No valid previous records found for today",
            ToastAndroid.SHORT
          );
        }
      } catch (error) {
        console.error("Error fetching records:", error);
        ToastAndroid.show(
          "Error fetching previous records",
          ToastAndroid.SHORT
        );
      }
    };
    fetchRecords();
  }, [BusinessId, collections, tagId]);

  const handleRowPress = (index, isPrevious = false) => {
    const adjustedIndex = isPrevious ? index + products.length : index;
    setSelectedIndices((prev) => {
      if (prev.includes(adjustedIndex)) {
        // Unselect if already selected
        return prev.filter((i) => i !== adjustedIndex);
      } else {
        // Select if not selected
        return [...prev, adjustedIndex];
      }
    });
    setShowDelete(
      selectedIndices.length > 0 || !selectedIndices.includes(adjustedIndex)
    );
    if (!isPrevious && parseFloat(products[index].weight) === 0) {
      ToastAndroid.show(
        "Weight is zero. Consider deleting this record.",
        ToastAndroid.SHORT
      );
    }
  };

  const handleDelete = async () => {
    if (selectedIndices.length > 0) {
      const networkState = await Network.getNetworkStateAsync();
      const productIndices = selectedIndices.filter((i) => i < products.length);
      const prevIndices = selectedIndices
        .filter((i) => i >= products.length)
        .map((i) => i - products.length);

      if (productIndices.length > 0) {
        const deletedProducts = products.filter((_, i) =>
          productIndices.includes(i)
        );
        setProducts(products.filter((_, i) => !productIndices.includes(i)));
        if (networkState.isConnected && BusinessId) {
          // Delete from Firestore for recently saved records
          const recentDocRef = await getDocs(
            query(
              collection(db, `Businesses/${BusinessId}/FieldCollections`),
              orderBy("timestamp", "desc"),
              limit(1)
            )
          );
          recentDocRef.forEach(async (docSnap) => {
            await deleteDoc(
              doc(db, `Businesses/${BusinessId}/FieldCollections/${docSnap.id}`)
            );
          });
        }
        ToastAndroid.show(
          `${productIndices.length} current record(s) deleted.`,
          ToastAndroid.SHORT
        );
      }
      if (prevIndices.length > 0) {
        const deletedPrevRecords = prevIndices.map((i) => previousRecords[i]);
        setPreviousRecords(
          previousRecords.filter((_, i) => !prevIndices.includes(i))
        );
        if (networkState.isConnected && BusinessId) {
          // Delete from Firestore for previous records
          await Promise.all(
            deletedPrevRecords.map(async (record) => {
              if (record.parentId) {
                await deleteDoc(
                  doc(
                    db,
                    `Businesses/${BusinessId}/FieldCollections/${record.parentId}`
                  )
                );
              }
            })
          );
        }
        ToastAndroid.show(
          `${prevIndices.length} previous record(s) deleted.`,
          ToastAndroid.SHORT
        );
      }
      setSelectedIndices([]);
      setShowDelete(false);
    }
  };

  const renderedProducts = useMemo(() => {
    return products.map((item, index) => (
      <TouchableOpacity
        key={`current-${index}`}
        onPress={() => handleRowPress(index)}
        style={[
          styles.tableRow,
          selectedIndices.includes(index) && { backgroundColor: "#FFD700" }, // Highlight selected row
        ]}
      >
        <Text style={[styles.tableCell, { minWidth: 40 }]}>{index + 1}</Text>
        <Text
          style={[styles.tableCell, { minWidth: 70 }]}
          numberOfLines={1}
          ellipsizeMode="clip"
        >
          {tagId || "N/A"}
        </Text>
        <Text
          style={[styles.tableCell, { minWidth: 100 }]}
          numberOfLines={1}
          ellipsizeMode="clip"
        >
          {item.label || "N/A"}
        </Text>
        <Text
          style={[styles.tableCell, { minWidth: 80 }]}
          numberOfLines={1}
          ellipsizeMode="clip"
        >
          {ageMonths ? `${ageMonths} months` : "N/A"}
        </Text>
        <Text
          style={[styles.tableCell, { minWidth: 100 }]}
          numberOfLines={1}
          ellipsizeMode="clip"
        >
          {fieldCollectionData.location.name || "N/A"}
        </Text>
        <Text
          style={[styles.tableCell, { minWidth: 60 }]}
          numberOfLines={1}
          ellipsizeMode="clip"
        >
          {item.weight || "0.00"}
        </Text>
        <Text
          style={[styles.tableCell, { minWidth: 90 }]}
          numberOfLines={1}
          ellipsizeMode="clip"
        >
          {new Date(item.timestamp).toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
          })}
        </Text>
        <Text
          style={[styles.tableCell, { minWidth: 70 }]}
          numberOfLines={1}
          ellipsizeMode="clip"
        >
          {new Date(item.timestamp).toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "numeric",
          })}
        </Text>
      </TouchableOpacity>
    ));
  }, [
    products,
    selectedIndices,
    tagId,
    ageMonths,
    fieldCollectionData.location.name,
  ]);

  const renderedPreviousRecords = useMemo(() => {
    return previousRecords.map((item, index) => {
      const adjustedIndex = index + products.length;
      return (
        <TouchableOpacity
          key={item.id || `prev-${index}`}
          onPress={() => handleRowPress(index, true)}
          style={[
            styles.tableRow,
            selectedIndices.includes(adjustedIndex) && {
              backgroundColor: "#FFD700",
            }, // Highlight selected row
          ]}
        >
          <Text style={[styles.tableCell, { minWidth: 40 }]}>{index + 1}</Text>
          <Text
            style={[styles.tableCell, { minWidth: 70 }]}
            numberOfLines={1}
            ellipsizeMode="clip"
          >
            {item.tagId || "N/A"}
          </Text>
          <Text
            style={[styles.tableCell, { minWidth: 100 }]}
            numberOfLines={1}
            ellipsizeMode="clip"
          >
            {item.label || "N/A"}
          </Text>
          <Text
            style={[styles.tableCell, { minWidth: 80 }]}
            numberOfLines={1}
            ellipsizeMode="clip"
          >
            {item.ageMonths ? `${item.ageMonths} months` : "N/A"}
          </Text>
          <Text
            style={[styles.tableCell, { minWidth: 100 }]}
            numberOfLines={1}
            ellipsizeMode="clip"
          >
            {item.location || "N/A"}
          </Text>
          <Text
            style={[styles.tableCell, { minWidth: 60 }]}
            numberOfLines={1}
            ellipsizeMode="clip"
          >
            {item.weight || "0.00"}
          </Text>
          <Text
            style={[styles.tableCell, { minWidth: 90 }]}
            numberOfLines={1}
            ellipsizeMode="clip"
          >
            {new Date(item.timestamp).toLocaleDateString("en-US", {
              year: "numeric",
              month: "short",
              day: "numeric",
            })}
          </Text>
          <Text
            style={[styles.tableCell, { minWidth: 70 }]}
            numberOfLines={1}
            ellipsizeMode="clip"
          >
            {new Date(item.timestamp).toLocaleTimeString("en-US", {
              hour: "numeric",
              minute: "numeric",
            })}
          </Text>
        </TouchableOpacity>
      );
    });
  }, [previousRecords, selectedIndices, products.length]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    console.log("onRefresh triggered");
    Promise.all([]).finally(() => {
      setRefreshing(false);
    });
  }, []);

  const parseBluetoothData = (data) => {
    console.log("Received data:", data);
    let numericValue = null;
    if (typeof data === "string") {
      try {
        const decodedData = atob(data);
        const match = decodedData.match(/-?\d+(\.\d+)?/);
        if (match) {
          numericValue = parseFloat(match[0]);
        }
      } catch (error) {
        const match = data.match(/-?\d+(\.\d+)?/);
        if (match) {
          console.log("value", match);
          numericValue = parseFloat(match[0]);
        }
      }
    } else if (typeof data === "number") {
      console.log("test", data);
      numericValue = data;
    }
    if (numericValue !== null && !isNaN(numericValue)) {
      console.log("Check1", numericValue);
      return {
        reading: numericValue.toFixed(2) + "kg",
        isStable: true,
      };
    }
    console.warn("No valid numeric value found in data:", data);
    return {
      reading: null,
      isStable: true,
    };
  };

  const handleSwitchBt = async () => {
    const printer = store.getState().settings.printerAddress;
    try {
      await connectToDevice(printer);
      console.log("Connected to printer:", printer);
      ToastAndroid.show("Printer connected successfully", ToastAndroid.SHORT);
    } catch (error) {
      console.error("Failed to connect to printer:", error);
      ToastAndroid.show("Failed to connect to printer", ToastAndroid.SHORT);
    }
  };

  const showPrinterReceipt = async () => {
    try {
      const location = fieldCollectionData.location.name || "Unknown";
      const animal = fieldCollectionData.animalType.name || "Unknown";
      const tagId = fieldCollectionData.tagId || "N/A";
      const age = fieldCollectionData.ageMonths || "N/A";
      const server = fieldCollectionData.clerk.name || "Unknown";
      const separator = "-----------------------------\n";

      let receiptData = "";
      receiptData += "\x1B\x40"; // Initialize printer
      receiptData += "\x1B\x33\x18"; // Set line spacing
      receiptData += "\x1B\x21\x30"; // Font A, double-height, double-width
      receiptData += "\x1B\x61\x01"; // Center align
      receiptData += "Animal Weighing Receipt\n";
      receiptData += "\x1B\x21\x00"; // Reset to Font A, normal
      receiptData += "\x1B\x61\x00"; // Left align
      receiptData += "\n";
      receiptData += `Day: ${new Date()
        .toLocaleDateString("en-US", { weekday: "long" })
        .padEnd(22)}\n`;
      receiptData += `Date: ${new Date().toLocaleDateString().padEnd(22)}\n`;
      receiptData += `Time: ${new Date()
        .toLocaleTimeString()
        .slice(0, 8)
        .padEnd(22)}\n`;
      receiptData += separator;
      receiptData += `Location: ${location.slice(0, 22).padEnd(22)}\n`;
      receiptData += separator;
      receiptData += "Animal Profile\n";
      receiptData += `Type: ${animal.slice(0, 22).padEnd(22)}\n`;
      receiptData += `TAG ID/NAME: ${tagId.slice(0, 22).padEnd(22)}\n`;
      receiptData +=
        `Age: ${age !== "N/A" ? `${age} months` : "N/A"}`.padEnd(22) + "\n";
      receiptData += separator;
      receiptData += "Weights (kg)\n";
      receiptData += separator;
      products
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .forEach((item, index) => {
          const wgt = parseFloat(item.weight || 0).toFixed(2);
          receiptData += `Weight ${index + 1}: ${wgt.padStart(10)}\n`;
        });
      receiptData += separator;
      receiptData += "\x1B\x21\x20"; // Font A, double-height
      receiptData += `Total: ${products
        .reduce((acc, item) => acc + (parseFloat(item.weight) || 0), 0)
        .toFixed(2)
        .padStart(4)} kg\n`;
      receiptData += "\x1B\x21\x00"; // Reset to Font A, normal
      receiptData += "\n";
      receiptData += `Served by: ${server.slice(0, 20).padEnd(20)}\n`;
      receiptData += "\n";
      receiptData += "\x1B\x61\x01"; // Center align
      receiptData += "Thank you!\n";
      receiptData += "==========================\n";
      receiptData += "\x1B\x61\x00"; // Left align
      receiptData += "\n\n\n";
      receiptData += "\x1D\x56\x00"; // Paper cut

      console.log(receiptData);
      const printerAddress = store.getState().settings.printerAddress;
      await writeToDevice(printerAddress, receiptData, "ascii");
      console.log("Receipt sent to the printer");
      ToastAndroid.show("Receipt printed successfully", ToastAndroid.SHORT);
    } catch (error) {
      console.error("Failed to print receipt:", error);
      ToastAndroid.show("Failed to print receipt", ToastAndroid.SHORT);
    }
  };

  const handleSaveRecord = async () => {
    setLoading(true);
    if (!location || products.length === 0) {
      ToastAndroid.show(
        "Please capture at least one weight",
        ToastAndroid.SHORT
      );
      setLoading(false);
      return;
    }
    try {
      const newRecord = {
        ...fieldCollectionData,
        products: products.map((item, index) => ({
          name: item.name,
          value: item.value,
          weight: parseFloat(item.weight || 0).toFixed(2),
          timestamp: item.timestamp || new Date().toISOString(), // Ensure timestamp is included
        })),
        weight: products
          .reduce((acc, item) => acc + (parseFloat(item.weight) || 0), 0)
          .toFixed(2),
        weights: products.map((item) => ({
          weight: parseFloat(item.weight) || 0,
          timestamp: item.timestamp || new Date().toISOString(), // Ensure timestamp is included
        })),
        totalWeight: products
          .reduce((acc, item) => acc + (parseFloat(item.weight) || 0), 0)
          .toFixed(2),
      };

      console.log(
        "Saving record with products length:",
        products.length,
        newRecord
      );
      const networkState = await Network.getNetworkStateAsync();
      if (networkState.isConnected) {
        const fieldCollectionsRef = collection(
          db,
          `Businesses/${BusinessId}/FieldCollections`
        );
        const docRef = await addDoc(fieldCollectionsRef, newRecord);
        console.log("Record saved successfully with ID:", docRef.id);
        ToastAndroid.show("Record saved successfully", ToastAndroid.SHORT);
        // Add all new weight records to previousRecords with unique IDs and latest timestamp
        const newPrevRecords = products.map((item, index) => ({
          id: `${docRef.id}-${index}-${Date.now()}`, // Unique ID with timestamp
          tagId: newRecord.tagId || "N/A",
          label: newRecord.animalType?.name || "Unknown",
          ageMonths:
            newRecord.ageMonths !== undefined ? newRecord.ageMonths : 0,
          weight: parseFloat(item.weight || 0).toFixed(2),
          location: newRecord.location?.name || "N/A",
          timestamp: item.timestamp || new Date().toISOString(), // Use capture timestamp
          parentId: docRef.id, // Store parent document ID for deletion
        }));
        console.log("New previous records:", newPrevRecords);
        setPreviousRecords((prev) => {
          const updatedRecords = [...newPrevRecords, ...prev].sort(
            (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
          );
          return updatedRecords;
        });
        setProducts([]);
      } else {
        store.dispatch(setCollections([...collections, newRecord]));
        console.log("Record saved to Redux store");
        ToastAndroid.show("Record saved to local storage", ToastAndroid.SHORT);
        const newPrevRecords = products.map((item, index) => ({
          id: `${Date.now()}-${index}`, // Unique ID for offline
          tagId: newRecord.tagId || "N/A",
          label: newRecord.animalType?.name || "Unknown",
          ageMonths:
            newRecord.ageMonths !== undefined ? newRecord.ageMonths : 0,
          weight: parseFloat(item.weight || 0).toFixed(2),
          location: newRecord.location?.name || "N/A",
          timestamp: item.timestamp || new Date().toISOString(), // Use capture timestamp
        }));
        console.log("New previous records (offline):", newPrevRecords);
        setPreviousRecords((prev) => {
          const updatedRecords = [...newPrevRecords, ...prev].sort(
            (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
          );
          return updatedRecords;
        });
        setProducts([]);
      }
      setLoading(false);
    } catch (error) {
      console.error("Error saving record:", error);
      ToastAndroid.show(
        "Error saving record. Please try again.",
        ToastAndroid.SHORT
      );
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Header refresh={refreshing} handleClick={onRefresh} />
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
      <TouchableOpacity
        style={styles.button}
        onPress={() => {
          if (scaleData.reading && selectedProduct) {
            setProducts([
              ...products,
              {
                label: selectedProduct.label || "",
                quantity: 1,
                weight: parseFloat(scaleData.reading.replace("kg", "")) || 0,
                price: parseFloat(selectedProduct.price) || 0,
                name: selectedProduct.label || "",
                value: selectedProduct.value || "",
                timestamp: new Date().toISOString(), // Add timestamp on capture
              },
            ]);
          } else {
            ToastAndroid.show(
              "Please select a product and ensure valid weight reading",
              ToastAndroid.SHORT
            );
          }
        }}
      >
        <Text style={styles.textButton}>Capture</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.button, { backgroundColor: "#F2F2F2" }]}
        onPress={() => setModalVisible(true)}
      >
        <Text style={styles.textButton}>Print Receipt</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.button, { backgroundColor: loading ? "#ccc" : "green" }]}
        onPress={handleSaveRecord}
      >
        {loading ? (
          <ActivityIndicator color="#00FF00" />
        ) : (
          <Text style={[styles.textButton, { color: "#fff" }]}>
            Save Record
          </Text>
        )}
      </TouchableOpacity>
      {showDelete && (
        <TouchableOpacity
          style={[styles.deleteButton, { backgroundColor: "red" }]}
          onPress={handleDelete}
        >
          <Text style={[styles.textButton, { color: "#fff" }]}>Delete</Text>
        </TouchableOpacity>
      )}
      <View style={styles.animalSection}>
        <Text style={styles.sectionHeader}>Animal Weight Records</Text>
        <View style={styles.animalDetails}>
          <Text style={styles.detailText}>
            Type: {animalType?.label || "N/A"}
          </Text>
          <Text style={styles.detailText}>TAG ID/NAME: {tagId || "N/A"}</Text>
          <Text style={styles.detailText}>
            Age: {ageMonths ? `${ageMonths} months` : "N/A"}
          </Text>
        </View>
        <ScrollView style={styles.scroll}>
          <ScrollView horizontal={true} showsHorizontalScrollIndicator={true}>
            <View style={styles.table}>
              <View style={styles.tableRow}>
                <Text style={[styles.tableHeader, { minWidth: 40 }]}>NO.</Text>
                <Text style={[styles.tableHeader, { minWidth: 70 }]}>
                  TAG ID/NAME
                </Text>
                <Text style={[styles.tableHeader, { minWidth: 100 }]}>
                  ANIMAL TYPE
                </Text>
                <Text style={[styles.tableHeader, { minWidth: 80 }]}>
                  AGE IN MONTHS
                </Text>
                <Text style={[styles.tableHeader, { minWidth: 100 }]}>
                  LOCATION
                </Text>
                <Text style={[styles.tableHeader, { minWidth: 60 }]}>
                  WEIGHT
                </Text>
                <Text style={[styles.tableHeader, { minWidth: 90 }]}>DATE</Text>
                <Text style={[styles.tableHeader, { minWidth: 70 }]}>TIME</Text>
              </View>
              {renderedProducts}
              {products.length > 0 && (
                <View style={styles.totalRow}>
                  <Text style={[styles.tableCell, { minWidth: 40 }]}></Text>
                  <Text style={[styles.tableCell, { minWidth: 70 }]}></Text>
                  <Text style={[styles.tableCell, { minWidth: 100 }]}></Text>
                  <Text style={[styles.tableCell, { minWidth: 80 }]}></Text>
                  <Text style={[styles.tableCell, { minWidth: 100 }]}></Text>
                  <Text style={[styles.tableCell, { minWidth: 60 }]}>
                    Total:{" "}
                    {products
                      .reduce(
                        (acc, item) => acc + (parseFloat(item.weight) || 0),
                        0
                      )
                      .toFixed(2)}{" "}
                    kg
                  </Text>
                  <Text style={[styles.tableCell, { minWidth: 90 }]}></Text>
                  <Text style={[styles.tableCell, { minWidth: 70 }]}></Text>
                </View>
              )}
              {previousRecords.length > 0 && (
                <>
                  <View style={styles.tableRow}>
                    <Text
                      style={[
                        styles.tableHeader,
                        { minWidth: 610, backgroundColor: "#e0e0e0" },
                      ]}
                    >
                      Previous Records (Today)
                    </Text>
                  </View>
                  {renderedPreviousRecords}
                </>
              )}
            </View>
          </ScrollView>
        </ScrollView>
      </View>
      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.centeredView}>
          <View style={styles.modalView}>
            <View style={styles.modalNav}>
              <View style={styles.modaltouchable}>
                <Text style={styles.touchableText}>Print Receipt</Text>
              </View>
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
                  console.log("Printing receipt");
                  await showPrinterReceipt();
                  setModalVisible(false);
                  console.log("Modal closed after print");
                }}
              >
                <Text style={styles.textButton}>Print</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.button}
                onPress={() => {
                  console.log("Modal closed without navigation");
                  setModalVisible(false);
                }}
              >
                <Text style={styles.textButton}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    paddingTop: 10,
    backgroundColor: "#F9F9F9",
  },
  display: {
    height: 100,
    width: screenWidth * 0.9,
    borderRadius: 10,
    flexDirection: "row",
    padding: 10,
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  data: {
    flex: 1,
  },
  button: {
    width: screenWidth * 0.9,
    backgroundColor: "#F2F2F2",
    paddingVertical: 12,
    alignItems: "center",
    margin: 10,
    borderRadius: 50,
  },
  deleteButton: {
    width: screenWidth * 0.9,
    paddingVertical: 12,
    alignItems: "center",
    margin: 10,
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
    paddingHorizontal: 10,
    marginBottom: 10,
  },
  detailText: {
    fontFamily: "Poppins-Regular",
    fontSize: Math.min(16, Math.max(12, screenWidth * 0.035)),
    flex: 1,
    textAlign: "center",
  },
  scroll: {
    backgroundColor: "white",
    width: screenWidth * 0.95,
    borderRadius: 10,
  },
  table: {
    flexDirection: "column",
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderColor: "#ddd",
    backgroundColor: "#fff",
  },
  tableHeader: {
    padding: 8,
    backgroundColor: "#f1f1f1",
    fontFamily: "Poppins-Bold",
    fontSize: Math.min(12, Math.max(9, screenWidth * 0.025)),
    textAlign: "center",
    borderRightWidth: 1,
    borderColor: "#ddd",
  },
  tableCell: {
    padding: 8,
    fontFamily: "Poppins-Regular",
    fontSize: Math.min(12, Math.max(9, screenWidth * 0.025)),
    textAlign: "center",
    borderRightWidth: 1,
    borderColor: "#ddd",
  },
  totalRow: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderColor: "#ddd",
    backgroundColor: "#f9f9f9",
  },
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
  centeredView: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 22,
  },
  modalView: {
    margin: 20,
    backgroundColor: "white",
    borderRadius: 20,
    padding: 35,
    width: screenWidth * 0.9,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  modalNav: {
    width: "100%",
    alignItems: "center",
    marginBottom: 20,
  },
  modaltouchable: {
    alignItems: "center",
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

export default RecordPage;*/

/*import * as Network from "expo-network";
import {
  StyleSheet,
  Text,
  View,
  Dimensions,
  TouchableOpacity,
  ScrollView,
  Modal,
  TextInput,
  ActivityIndicator,
  ToastAndroid,
} from "react-native";
import React, { useState, useEffect, useRef, useMemo } from "react";
import DropdownComponent from "../Components/DropDown";
import Header from "../Components/Header";
import AntDesign from "@expo/vector-icons/AntDesign";
import { useBluetooth } from "rn-bluetooth-classic";
import { addDoc, collection, getDocs } from "firebase/firestore";
import { db } from "../Database/config";
import { store } from "../store/store";
import { useDispatch, useSelector } from "react-redux";
import { setSuppliers, setCollections } from "../store";
import {
  BottomSheetModal,
  BottomSheetModalProvider,
} from "@gorhom/bottom-sheet";
import RNBluetooth from "react-native-bluetooth-classic";

const { width: screenWidth, height: screenHeight } = Dimensions.get("window");

const RecordPage = ({ route, navigation }) => {
  const { location, product, productsData } = route.params;
  const dispatch = useDispatch();
  const collections = useSelector((state) => state.settings.collections);
  const suppliers = useSelector((state) => state.settings.suppliers);
  const { BusinessId, user } = useSelector((state) => state.settings);

  const [modalVisible, setModalVisible] = useState(false);
  const [connectedDevice, setConnectedDevice] = useState(null);
  const [scaleStability, setScaleStability] = useState(null);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [totalQuantity, setTotalQuantity] = useState(0);
  const [totalWeight, setTotalWeight] = useState(0);
  const [totalPrice, setTotalPrice] = useState(0);

  // Advancements state
  const [advanceAmount, setAdvanceAmount] = useState("");
  const [barterItem, setBarterItem] = useState(null);
  const [barterWeight, setBarterWeight] = useState("");
  const [advanceType, setAdvanceType] = useState("cash");
  const [advancements, setAdvancements] = useState([]);
  const [totalAdvanced, setTotalAdvanced] = useState(0);

  const bottomSheetModalRef = useRef(null);

  const {
    devices,
    connectToDevice,
    receivedData,
    isConnected,
    disconnectDevice,
    writeToDevice,
    readFromDevice,
  } = useBluetooth();

  const [scaleData, setScaleData] = useState({ reading: null, isStable: false });

  // useEffect(() => {
  //   console.log("Data",receivedData)
  //   if (receivedData) {
  //     const parsedData = parseBluetoothData(receivedData);
  //     if (JSON.stringify(parsedData) !== JSON.stringify(scaleData)) {
  //       setScaleData(parsedData);
  //       console.log("scaledata:",scaleData);
  //     }
  //   }
  // }, [receivedData]);
  useEffect(() => {
    if (receivedData) {
      const parsedData = parseBluetoothData(receivedData);
  
      // Ensure parsedData.reading is not null before proceeding
      if (parsedData.reading !== null && JSON.stringify(parsedData) !== JSON.stringify(scaleData)) {
        setScaleData(parsedData);
        console.log("PARSED", parsedData);
        console.log("scaledata:", scaleData);
      }
    }
  }, [receivedData]);



  const fieldCollectionData = useMemo(
    () => ({
      supplier: {
        id: selectedSupplier?.value,
        name: selectedSupplier?.label,
      },
      clerk: {
        id: user?.clerkId,
        name: `${user?.fName} ${user?.lName}`,
      },
      location: {
        name: location?.label,
        subLocation: "Sub-Location A",
      },
      product: {
        price: product?.price,
        name: product?.label,
        id: product?.value,
      },
      timestamp: new Date().toISOString(),
    }),
    [selectedSupplier, user, location, product]
  );

  useEffect(() => {
    getSuppliers();
  }, []);

  useEffect(() => {
    const newTotalQuantity = products.reduce(
      (acc, item) => acc + parseInt(item.quantity),
      0
    );
    const newTotalWeight = products.reduce(
      (acc, item) => acc + parseFloat(item.weight),
      0
    );
    const newTotalPrice = newTotalWeight * product.price;
    setTotalQuantity(newTotalQuantity);
    setTotalWeight(newTotalWeight.toFixed(2));
    setTotalPrice(newTotalPrice.toFixed(2));
  }, [products, product.price]);

  useEffect(() => {
    const newTotalAdvanced = advancements.reduce((sum, adv) => {
      if (adv.type === "cash") {
        return sum + parseFloat(adv.amount);
      } else {
        return sum + parseFloat(adv.item.price) * parseFloat(adv.weight);
      }
    }, 0);
    setTotalAdvanced(newTotalAdvanced);
  }, [advancements]);

  const getSuppliers = async () => {
    const suppliersCollection = collection(
      db,
      `Businesses/${BusinessId}/Suppliers`
    );
    const suppliersSnapshot = await getDocs(suppliersCollection);
    const suppliersData = suppliersSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    dispatch(setSuppliers(suppliersData));
  };

  const onRefresh = React.useCallback(() => {
    setRefreshing(true);
    getSuppliers();
    setTimeout(() => {
      setRefreshing(false);
    }, 2000);
  }, []);

  const supplierData = suppliers
    ? suppliers.map((supplier) => ({
        label: supplier.fName,
        value: supplier.id,
      }))
    : [];


   
const parseBluetoothData = (data) => {
  console.log("Received data:", data);

  let numericValue = null;

  // Try to extract a numeric value from the data
  if (typeof data === 'string') {
    // First, try to decode if it's base64 encoded
    try {
      const decodedData = atob(data);
      const match = decodedData.match(/-?\d+(\.\d+)?/);
      if (match) {
        numericValue = parseFloat(match[0]);
      }
    } catch (error) {
      // If decoding fails, it's not base64, so we'll try to extract numbers directly
      const match = data.match(/-?\d+(\.\d+)?/);
      if (match) {
        console.log("value",match)
        numericValue = parseFloat(match[0]);
      }
    }
  } else if (typeof data === 'number') {
    console.log("test",data);
    numericValue = data;
  }

  // If we found a valid numeric value, return it with 'kg' appended
  if (numericValue !== null) {
    console.log("Check1", numericValue)

    return {
      reading: numericValue.toFixed(2) + 'kg',
      isStable: true // Always set to true as per requirement
    };
  }

  // If no valid numeric value was found, return null reading
  return {
     reading: null,
    isStable: true // Always set to true as per requirement
  };
};

// const parseBluetoothData = (data) => {
//   console.log("Received data:", data);

//   let numericValue = null;

//   // Try to extract a numeric value from the data
//   if (typeof data === 'string') {
//     // First, try to decode if it's base64 encoded
//     try {
//       const decodedData = atob(data);
//       const match = decodedData.match(/-?\d+(\.\d+)?/);
//       if (match) {
//         numericValue = parseFloat(match[0]);
//       }
//     } catch (error) {
//       // If decoding fails, it's not base64, so we'll try to extract numbers directly
//       const match = data.match(/-?\d+(\.\d+)?/);
//       if (match) {
//         console.log("value",match)
//         numericValue = parseFloat(match[0]);
//       }
//     }
//   } else if (typeof data === 'number') {
//     console.log("test",data);
//     numericValue = data;
//   }

//   // If we found a valid numeric value, return it with 'kg' appended
//   if (numericValue !== null) {
//     console.log("Check1", numericValue)

//     return {
//       reading: numericValue.toFixed(2) + 'kg',
//       isStable: true // Always set to true as per requirement
//     };
//   }

//   // If no valid numeric value was found, return null reading
//   return {
//     reading: null,
//     isStable: true // Always set to true as per requirement
//   };
// };
  

  const handleSwitchBt = async () => {
    const printer = store.getState().settings.printerAddress;
    connectToDevice(printer);
    console.log("Printer: ", printer);
  };

  const showPrinterReceipt = async () => {
    console.log(products);
    const supplier = fieldCollectionData.supplier.name;
    const supplierID = fieldCollectionData.supplier.id;
    const location = fieldCollectionData.location.name;
    const sublocation = fieldCollectionData.location.subLocation;
    const product = fieldCollectionData.product.name;
    const items = products;
    const server = fieldCollectionData.clerk.name;
    const separator = "-----------------------------\n";

    let receiptData = "";
    receiptData += "====== Weighing Receipt =====\n\n";
    receiptData += `Supplier: ${supplier.padEnd(10)} ID: ${supplierID}\n`;
    receiptData += `Location: ${location.padEnd(10)}\n`;
    receiptData += `Date: ${new Date()
      .toLocaleDateString()
      .padEnd(9)} Time: ${new Date().toLocaleTimeString()}\n\n`;

    receiptData += "----------- Products -----------\n";
    receiptData += "Product  Qty   Weight(Kg)  Price\n";
    items.forEach((item) => {
      const { label, quantity, weight, price } = item;
      const qty = parseInt(quantity, 10);
      const wgt = parseFloat(weight);
      const prc = parseFloat(price);
      receiptData += `${label.padEnd(8)} ${qty.toString().padStart(2)} ${wgt
        .toFixed(2)
        .padStart(9)} ${prc.toFixed(2).padStart(10)}\n`;
    });
    receiptData += separator;
    receiptData += `Total:${totalQuantity.toString().padStart(6)} ${parseFloat(
      totalWeight
    )
      .toFixed(2)
      .padStart(10)} ${parseFloat(totalPrice).toFixed(2).padStart()}\n\n`;

    receiptData += "--------- Advancements --------\n";
    receiptData += "Type    Amount/Item   Weight(Kg)\n";
    advancements.forEach((adv) => {
      if (adv.type === "cash") {
        receiptData += `Cash     ${parseFloat(adv.amount)
          .toFixed(2)
          .padStart(9)}      -\n`;
      } else {
        receiptData += `Barter   ${adv.item.label.padEnd(9)} ${parseFloat(
          adv.weight
        )
          .toFixed(2)
          .padStart(9)}\n`;
      }
    });
    receiptData += "\n";
    receiptData += `Total Advanced: Ksh ${parseFloat(totalAdvanced).toFixed(
      2
    )}\n`;
    receiptData += `Net Pay: Ksh ${(
      parseFloat(totalPrice) - parseFloat(totalAdvanced)
    ).toFixed(2)}\n\n`;

    receiptData += `Served by: ${server}\n\n`;
    receiptData += "Thank you for your business!\n";
    receiptData += "===========================\n";
    receiptData += "\n\n\n"; // Extra lines for printer feed

    console.log(receiptData); // For debugging

    const printer = store.getState().settings.printerAddress;
    writeToDevice(printer, receiptData, "ascii");
    console.log("Receipt sent to the printer");
  };

  const handleSaveRecord = async () => {
    setLoading(true);
    if (!location || !product || !selectedSupplier || products.length === 0) {
      ToastAndroid.show("Please fill all required fields", ToastAndroid.SHORT);
      setLoading(false);
      return;
    }

    try {
      const newRecord = {
        ...fieldCollectionData,
        products,
        quantity: totalQuantity,
        weight: totalWeight,
        advancements,
        totalAdvanced,
        totalPrice: totalPrice,
        remainingBalance: totalPrice - totalAdvanced,
      };

      console.log("New Record:", newRecord);

      const networkState = await Network.getNetworkStateAsync();
      if (networkState.isConnected) {
        const fieldCollectionsRef = collection(
          db,
          `Businesses/${BusinessId}/FieldCollections`
        );
        const docRef = await addDoc(fieldCollectionsRef, newRecord);
        console.log("Record saved successfully:", docRef.id);
        ToastAndroid.show("Record saved successfully", ToastAndroid.SHORT);
      } else {
        dispatch(setCollections([...collections, newRecord]));
        console.log("Record saved to Redux store");
        ToastAndroid.show("Record saved to local storage", ToastAndroid.SHORT);
      }

      setModalVisible(true);
      setLoading(false);
    } catch (error) {
      console.error("Error saving record:", error);
      ToastAndroid.show(
        "Error saving record. Please try again.",
        ToastAndroid.SHORT
      );
      setLoading(false);
    }
  };

  const handleAdvancement = () => {
    if (advanceType === "cash") {
      if (isNaN(parseFloat(advanceAmount)) || parseFloat(advanceAmount) <= 0) {
        ToastAndroid.show("Please enter a valid amount", ToastAndroid.SHORT);
        return;
      }
      const newAdvance = { type: "cash", amount: parseFloat(advanceAmount) };
      setAdvancements([...advancements, newAdvance]);
    } else {
      if (!barterItem) {
        ToastAndroid.show(
          "Please enter valid barter details",
          ToastAndroid.SHORT
        );
        return;
      }
      const newAdvance = {
        type: "barter",
        item: barterItem,
        weight: parseFloat(scaleData.reading || "0.00 Kg"),
      };
      setAdvancements([...advancements, newAdvance]);
    }

    bottomSheetModalRef.current?.dismiss();
    setAdvanceAmount("");
    setBarterItem(null);
    setBarterWeight("");
  };

//   useEffect(() => {
//     let encodedString = "AkQgIC0wLjMz9Q0=";
// let decodedString = atob(encodedString);
// console.log(decodedString);
//  console.log("OCS ");
//   }, [receivedData]);

// useEffect(() => {
//   if (receivedData) {
//     // Check if the receivedData is a Base64 encoded string
//     if (/^[A-Za-z0-9+/=]+$/.test(receivedData)) {
//       try {
//         let decodedString = atob(receivedData);
//         console.log("Decoded Base64 string:", decodedString);
//       } catch (error) {
//         console.error("Error decoding Base64 string:", error);
//       }
//     } 
//     // Check if the receivedData matches the format "XX,XX,+/-XX.XXxx" with possible spaces
//     else if (/^[A-Z]{2},[A-Z]{2},[+-]\s*\d+(\.\d+)?[a-zA-Z]{2}$/.test(receivedData)) {
//       try {
//         const decodedFormat = decodeString(receivedData);
//         console.log("Decoded formatted string:", decodedFormat);
//       } catch (error) {
//         console.error("Error decoding formatted string:", error);
//       }
//     } 
//     else {
//       console.log("Received data doesn't match any known format:", receivedData);
//     }
//   }
// }, [receivedData]);


  return (
    <View style={styles.container}>
      <Header refresh={refreshing} handleClick={onRefresh} />
      <DropdownComponent
        title="Suppliers"
        onChange={setSelectedSupplier}
        data={supplierData}
      />

      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.centeredView}>
          <View style={styles.modalView}>
            <View style={styles.modalNav}>
              <View style={styles.modaltouchable}>
                <Text style={styles.touchableText}>Print Receipt</Text>
              </View>
            </View>
            <View style={styles.modalContent}>
              <TouchableOpacity
                style={[, styles.button, { borderRadius: 20 }]}
                onPress={handleSwitchBt}
              >
                <AntDesign name="printer" size={34} color="blue" />
                <Text style={styles.textButton}>Reconnect printer</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.button}
                onPress={showPrinterReceipt}
              >
                <Text style={styles.textButton}>Print</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

          <View
            style={[
              styles.display,
              {
                backgroundColor: scaleData.isStable ? "green" : "red",
              },
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

      <TouchableOpacity
        style={styles.button}
        onPress={() => {
          if (scaleData.reading) {
            setProducts([
              ...products,
              {
                ...product,
                quantity: 1,
                weight: parseFloat(scaleData.reading),
              },
            ]);
          } else {
            ToastAndroid.show("No valid weight reading", ToastAndroid.SHORT);
          }
        }}
      >
        <Text style={styles.textButton}>Capture</Text>
      </TouchableOpacity>

   

      <TouchableOpacity
        style={styles.button}
        onPress={() => bottomSheetModalRef.current?.present()}
      >
        <Text style={styles.textButton}>Add Advancement</Text>
      </TouchableOpacity>

      <View style={styles.preview}>
        <ScrollView style={styles.scroll}>
          <View style={styles.table}>
            <Text style={styles.tableHeader}>Records</Text>
            <View style={styles.tableRow}>
              <Text style={styles.tableHeader}>Item</Text>
              <Text style={styles.tableHeader}>Quantity</Text>
              <Text style={styles.tableHeader}>Weight</Text>
            </View>
            {products.map((item, index) => (
              <View style={styles.tableRow} key={index}>
                <Text style={styles.tableCell}>{item.label}</Text>
                <Text style={styles.tableCell}>{item.quantity}</Text>
                <Text style={styles.tableCell}>{item.weight}</Text>
              </View>
            ))}
            <View style={styles.totalRow}>
              <Text style={styles.tableCell}>Total</Text>
              <Text style={styles.tableCell}>{totalQuantity}</Text>
              <Text style={styles.tableCell}>{totalWeight}</Text>
            </View>
            <Text style={styles.tableHeader}>Advancements</Text>
            <View style={styles.tableRow}>
              <Text style={styles.tableHeader}>Type</Text>
              <Text style={styles.tableHeader}>Amount</Text>
              <Text style={styles.tableHeader}>Price</Text>
            </View>
            {advancements.map((adv, index) => (
              <View style={styles.tableRow} key={index}>
                <Text style={styles.tableCell}>
                  {adv.type === "cash" ? "Cash" : adv.item.label}
                </Text>
                <Text style={styles.tableCell}>
                  {adv.type === "cash" ? adv.amount : adv.weight}
                </Text>
                <Text style={styles.tableCell}>
                  {adv.type === "cash" ? "" : adv.item.price}
                </Text>
              </View>
            ))}

            <View style={styles.totalRow}>
              <Text style={styles.tableCell}>Total</Text>
              <Text style={styles.tableCell}></Text>
              <Text style={styles.tableCell}>{totalAdvanced.toFixed(2)}</Text>
            </View>
          </View>
        </ScrollView>
      </View>

      <TouchableOpacity
        style={[styles.button, { backgroundColor: loading ? "#ccc" : "green" }]}
        onPress={handleSaveRecord}
      >
        {loading ? (
          <ActivityIndicator color="#00FF00" />
        ) : (
          <Text style={[styles.textButton, { color: "#fff" }]}>
            Save Record
          </Text>
        )}
      </TouchableOpacity>

      <BottomSheetModal
        ref={bottomSheetModalRef}
        index={0}
        snapPoints={["50%", "75%"]}
      >
        <View style={styles.bottomSheetContent}>
          <Text style={styles.modalTitle}>Add Advancement</Text>

          <View style={styles.advanceTypeSelection}>
            <TouchableOpacity
              style={[
                styles.advanceTypeButton,
                advanceType === "cash" && styles.selectedAdvanceType,
              ]}
              onPress={() => setAdvanceType("cash")}
            >
              <Text>Cash</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.advanceTypeButton,
                advanceType === "barter" && styles.selectedAdvanceType,
              ]}
              onPress={() => setAdvanceType("barter")}
            >
              <Text>Dukawala (Barter)</Text>
            </TouchableOpacity>
          </View>

          {advanceType === "cash" ? (
            <TextInput
              style={styles.input}
              placeholder="Enter cash amount"
              value={advanceAmount}
              onChangeText={setAdvanceAmount}
              keyboardType="numeric"
            />
          ) : (
            <>
              <DropdownComponent
                title="Select item"
                data={productsData}
                onChange={setBarterItem}
              />
              <View style={styles.advanceTypeSelection}>
                <Text
                  style={{
                    marginRight: 10,
                    fontFamily: "Poppins-Regular",
                    fontSize: 16,
                  }}
                >
                  Weight:
                </Text>
                <Text
                  style={{
                    marginRight: 10,
                    fontFamily: "Poppins-Regular",
                    fontSize: 16,
                  }}
                >
                  {receivedData &&
                    parseFloat(
                      receivedData
                        .toString()
                        .match(/[+-]?\d*\.?\d+/g)
                        ?.join(", ")
                    )}{" "}
                  Kg
                </Text>
              </View>
            </>
          )}

          <TouchableOpacity style={styles.button} onPress={handleAdvancement}>
            <Text style={styles.advanceButtonText}>Add Advancement</Text>
          </TouchableOpacity>
        </View>
      </BottomSheetModal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    paddingTop: 10,
    backgroundColor: "#F9F9F9",
  },
  display: {
    height: 100,
    width: screenWidth * 0.9,
    borderRadius: 10,
    flexDirection: "row",
    padding: 10,
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  data: {
    flex: 1,
  },
  centeredView: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 22,
  },
  modalView: {
    margin: 20,
    backgroundColor: "white",
    borderRadius: 20,
    padding: 35,
    width: screenWidth * 0.9,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  button: {
    width: screenWidth * 0.9,
    backgroundColor: "#F2F2F2",
    paddingVertical: 12,
    alignItems: "center",
    margin: 10,
    borderRadius: 50,
  },
  textButton: {
    fontFamily: "Poppins-Regular",
    fontSize: 16,
  },
  preview: {
    height: 200,
    backgroundColor: "#F2F2F2",
    borderRadius: 10,
    flex: 1,
    width: screenWidth * 0.9,
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 5,
    marginVertical: 10,
  },
  scroll: {
    backgroundColor: "white",
    width: "100%",
    borderRadius: 10,
  },
  table: {
    width: "100%",
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderColor: "#ddd",
  },
  tableHeader: {
    flex: 1,
    padding: 10,
    backgroundColor: "#f1f1f1",
    fontWeight: "bold",
    textAlign: "center",
  },
  tableCell: {
    flex: 1,
    padding: 10,
    textAlign: "center",
  },
  totalRow: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderColor: "#ddd",
    backgroundColor: "#f9f9f9",
  },
  textBold: {
    fontFamily: "Poppins-Bold",
    fontSize: 14,
    color: "white",
  },
  textRegular: {
    fontFamily: "Poppins-Regular",
    fontSize: 14,
    color: "white",
  },
  textWeight: {
    fontFamily: "Poppins-Regular",
    fontSize: 24,
    color: "white",
  },
  advancementSummary: {
    width: screenWidth * 0.8,
    backgroundColor: "#F2F2F2",
    padding: 15,
    borderRadius: 10,
    marginVertical: 10,
  },
  summaryText: {
    fontFamily: "Poppins-Regular",
    fontSize: 16,
    marginBottom: 5,
  },
  bottomSheetContent: {
    flex: 1,
    alignItems: "center",
    padding: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 20,
  },
  advanceTypeSelection: {
    flexDirection: "row",
    marginBottom: 20,
  },
  advanceTypeButton: {
    padding: 10,
    marginHorizontal: 10,
    borderWidth: 1,
    borderRadius: 5,
  },
  selectedAdvanceType: {
    backgroundColor: "#e0e0e0",
  },
  input: {
    width: "100%",
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 5,
    padding: 10,
    marginBottom: 10,
  },
  advanceButtonText: {
    color: "#000000",
    fontWeight: "bold",
  },
});

export default RecordPage;*/
