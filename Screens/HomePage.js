import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  Text,
  StyleSheet,
  View,
  Dimensions,
  RefreshControl,
  TouchableOpacity,
  ScrollView,
  ToastAndroid,
  TextInput,
  FlatList,
  Modal,
  Alert,
  TouchableWithoutFeedback,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import DropdownComponent from "../Components/DropDown";
import Header from "../Components/Header";
import { useNavigation } from "@react-navigation/native";
import { store } from "../store/store";
import { setCollectionRecords, setLocations, setProducts } from "../store";
import { useDispatch } from "react-redux";
import {
  collection,
  getDocs,
  query,
  orderBy,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../Database/config";
import { useBluetooth } from "rn-bluetooth-classic";
import RNBluetooth from "react-native-bluetooth-classic";

const screenWidth = Dimensions.get("window").width;
const responsiveSize = (size) => (screenWidth * size) / 375;

// AsyncStorage Keys
const SESSIONS_KEY = "@dry_goods_records";
const DRY_STOCK_KEY = "@dry_goods_stock";
const COLD_STOCK_KEY = "@coldroom_stock";
const REMOVALS_KEY = "@stock_removals";
const STORAGE_STORES_KEY = "@storage_stores_list";
const CARCASS_SESSIONS_KEY = "@carcass_sessions";
const CARCASS_BATCH_COUNTER_KEY = "@carcass_batch_counter";
const CARCASS_DELETIONS_KEY = "@carcass_deletions";
const DRY_GOODS_DELETIONS_KEY = "@dry_goods_deletions";
const BUTCHERY_BATCHES_KEY = "@butchery_batches";
const DEBONNED_RECORDS_KEY = "@debonned_records";
const SPOILAGE_REMOVALS_KEY = "@spoilage_removals";
const PROCESSING_RECORDS_KEY = "@processing_records";
const RECIPES_KEY = "@processing_recipes";
const PACKING_RECORDS_KEY = "@packing_records";
const PACKED_PRODUCTS_KEY = "@packed_products";

// Helper function to sync data to Firebase
const syncToFirebase = async (collectionName, data, businessId) => {
  try {
    const syncData = {
      ...data,
      businessId: businessId || store.getState().settings.BusinessId,
      syncTimestamp: serverTimestamp(),
      localTimestamp: new Date().toISOString(),
    };
    await addDoc(collection(db, collectionName), syncData);
    console.log(`Synced to Firebase: ${collectionName}`);
  } catch (error) {
    console.error(`Failed to sync to Firebase (${collectionName}):`, error);
  }
};

// Helper to get stock key for any store
const getStockKeyForStore = (storeValue) => {
  if (storeValue === "dry") return DRY_STOCK_KEY;
  if (storeValue === "cold") return COLD_STOCK_KEY;
  return `@stock_${storeValue}`;
};

// Format batch code from a counter
const formatBatchCode = (counter) => {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, "");
  return `CARCASS-${dateStr}-${String(counter).padStart(3, "0")}`;
};

// Format processing batch code
const formatProcessingBatchCode = (productName, counter) => {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, "");
  const productCode = productName
    .toUpperCase()
    .replace(/\s+/g, "-")
    .substring(0, 20);
  return `${productCode}-${dateStr}-${String(counter).padStart(3, "0")}`;
};

// Format pack batch number
const formatPackBatchNumber = (productName, packNumber) => {
  const productCode = productName
    .toUpperCase()
    .replace(/\s+/g, "-")
    .substring(0, 20);
  return `${productCode}-PACK-${String(packNumber).padStart(3, "0")}`;
};

// ============ ADD AMOUNT MODAL ============
const AddAmountModal = ({ visible, item, onAdd, onClose }) => {
  const [amount, setAmount] = useState("");

  useEffect(() => {
    if (!visible) setAmount("");
  }, [visible]);

  const handleAdd = () => {
    const numAmount = parseFloat(amount);
    if (!isNaN(numAmount) && numAmount > 0) {
      onAdd(numAmount);
      setAmount("");
    } else {
      ToastAndroid.show("Please enter a valid amount", ToastAndroid.SHORT);
    }
  };

  return (
    <Modal
      animationType="fade"
      transparent={true}
      visible={visible}
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.modalOverlay}>
          <TouchableWithoutFeedback>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Add Ingredient Amount</Text>
              <Text style={styles.modalSubtitle}>
                Item: {item?.label || ""}
              </Text>
              <TextInput
                style={styles.inputField}
                placeholder="Amount per piece (kg)"
                keyboardType="decimal-pad"
                value={amount}
                onChangeText={setAmount}
                autoFocus={true}
              />
              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={[styles.modalButton, { backgroundColor: "#4CAF50" }]}
                  onPress={handleAdd}
                >
                  <Text style={styles.modalButtonText}>Add</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalButton, { backgroundColor: "#888" }]}
                  onPress={onClose}
                >
                  <Text style={styles.modalButtonText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

// ============ CREATE RECIPE MODAL (FIXED: allows custom ingredients) ============
const CreateRecipeModal = ({
  visible,
  onClose,
  onSave,
  dryGoodsItems,
  carcassItems,
}) => {
  const [recipeName, setRecipeName] = useState("");
  const [packSize, setPackSize] = useState("");
  const [piecesPerPack, setPiecesPerPack] = useState("");
  const [recipeItems, setRecipeItems] = useState([]);
  const [dryGoodsSearchText, setDryGoodsSearchText] = useState("");
  const [carcassSearchText, setCarcassSearchText] = useState("");
  const [customName, setCustomName] = useState("");
  const [customAmount, setCustomAmount] = useState("");
  const [filteredDryGoods, setFilteredDryGoods] = useState(dryGoodsItems);
  const [filteredCarcass, setFilteredCarcass] = useState(carcassItems);
  const [amountModalVisible, setAmountModalVisible] = useState(false);
  const [selectedIngredientType, setSelectedIngredientType] = useState(null);
  const [selectedIngredientItem, setSelectedIngredientItem] = useState(null);
  const [pieceWeight, setPieceWeight] = useState(0);

  useEffect(() => {
    if (!visible) {
      setRecipeName("");
      setPackSize("");
      setPiecesPerPack("");
      setRecipeItems([]);
      setDryGoodsSearchText("");
      setCarcassSearchText("");
      setCustomName("");
      setCustomAmount("");
      setPieceWeight(0);
    }
  }, [visible]);

  useEffect(() => {
    const totalWeight = recipeItems.reduce(
      (sum, item) => sum + item.amountPerPiece,
      0,
    );
    setPieceWeight(totalWeight);
  }, [recipeItems]);

  useEffect(() => {
    if (dryGoodsSearchText.trim() === "") {
      setFilteredDryGoods(dryGoodsItems);
    } else {
      setFilteredDryGoods(
        dryGoodsItems.filter((item) =>
          item.label.toLowerCase().includes(dryGoodsSearchText.toLowerCase()),
        ),
      );
    }
  }, [dryGoodsSearchText, dryGoodsItems]);

  useEffect(() => {
    if (carcassSearchText.trim() === "") {
      setFilteredCarcass(carcassItems);
    } else {
      setFilteredCarcass(
        carcassItems.filter((item) =>
          item.batchCode
            .toLowerCase()
            .includes(carcassSearchText.toLowerCase()),
        ),
      );
    }
  }, [carcassSearchText, carcassItems]);

  const addIngredient = (type, item, amount) => {
    const existingIndex = recipeItems.findIndex(
      (i) => i.type === type && i.itemId === (item.value || item.id),
    );
    if (existingIndex !== -1) {
      const updated = [...recipeItems];
      updated[existingIndex].amountPerPiece += amount;
      setRecipeItems(updated);
      ToastAndroid.show(`Updated ${item.label}`, ToastAndroid.SHORT);
    } else {
      setRecipeItems([
        ...recipeItems,
        {
          id: Date.now().toString(),
          type: type,
          itemId: item.value || item.id,
          itemName: item.label,
          amountPerPiece: amount,
        },
      ]);
      ToastAndroid.show(`Added ${item.label}`, ToastAndroid.SHORT);
    }
  };

  const addCustomIngredient = () => {
    if (!customName.trim()) {
      ToastAndroid.show("Please enter ingredient name", ToastAndroid.SHORT);
      return;
    }
    const amount = parseFloat(customAmount);
    if (isNaN(amount) || amount <= 0) {
      ToastAndroid.show(
        "Enter valid amount per piece (kg)",
        ToastAndroid.SHORT,
      );
      return;
    }
    const newIngredient = {
      id: Date.now().toString(),
      type: "custom",
      itemId: `custom_${Date.now()}`,
      itemName: customName.trim(),
      amountPerPiece: amount,
    };
    setRecipeItems([...recipeItems, newIngredient]);
    ToastAndroid.show(
      `Added custom ingredient: ${customName.trim()}`,
      ToastAndroid.SHORT,
    );
    setCustomName("");
    setCustomAmount("");
  };

  const removeIngredient = (id) => {
    setRecipeItems(recipeItems.filter((i) => i.id !== id));
    ToastAndroid.show("Ingredient removed", ToastAndroid.SHORT);
  };

  const handleSave = () => {
    if (!recipeName.trim()) {
      ToastAndroid.show("Please enter a recipe name", ToastAndroid.SHORT);
      return;
    }
    if (!packSize.trim()) {
      ToastAndroid.show(
        "Please enter pack size (e.g., 500g)",
        ToastAndroid.SHORT,
      );
      return;
    }
    if (!piecesPerPack.trim() || parseInt(piecesPerPack) <= 0) {
      ToastAndroid.show(
        "Please enter valid pieces per pack",
        ToastAndroid.SHORT,
      );
      return;
    }
    if (recipeItems.length === 0) {
      ToastAndroid.show(
        "Please add at least one ingredient",
        ToastAndroid.SHORT,
      );
      return;
    }

    const packSizeNum = parseFloat(packSize);
    const piecesPerPackNum = parseInt(piecesPerPack);
    const pieceWeightNum = pieceWeight;
    const calculatedPackWeight = pieceWeightNum * piecesPerPackNum;

    if (Math.abs(calculatedPackWeight * 1000 - packSizeNum) > 1) {
      Alert.alert(
        "Weight Mismatch",
        `Calculated pack weight: ${(calculatedPackWeight * 1000).toFixed(2)}g\n` +
          `Entered pack size: ${packSizeNum}g\n\nDo you want to continue?`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Continue", onPress: () => saveRecipeData() },
        ],
      );
    } else {
      saveRecipeData();
    }
  };

  const saveRecipeData = () => {
    const packSizeNum = parseFloat(packSize);
    const piecesPerPackNum = parseInt(piecesPerPack);
    onSave(
      recipeName.trim(),
      recipeItems,
      packSizeNum,
      piecesPerPackNum,
      pieceWeight,
    );
    onClose();
  };

  const renderDryGoodsItem = ({ item }) => (
    <View style={styles.stockItem}>
      <View style={styles.stockDetails}>
        <Text style={styles.stockType}>{item.label}</Text>
      </View>
      <TouchableOpacity
        style={[styles.removeButton, { backgroundColor: "#0066CC" }]}
        onPress={() => {
          setSelectedIngredientType("dry");
          setSelectedIngredientItem(item);
          setAmountModalVisible(true);
        }}
      >
        <Text style={styles.removeButtonText}>Add</Text>
      </TouchableOpacity>
    </View>
  );

  const renderCarcassItem = ({ item }) => (
    <View style={styles.stockItem}>
      <View style={styles.stockDetails}>
        <Text style={styles.stockType}>{item.type}</Text>
        <Text style={styles.stockInfo}>Batch: {item.batchCode}</Text>
        <Text style={styles.stockInfo}>
          Available: {item.currentWeight?.toFixed(6)} kg
        </Text>
      </View>
      <TouchableOpacity
        style={[styles.removeButton, { backgroundColor: "#FFA500" }]}
        onPress={() => {
          setSelectedIngredientType("carcass");
          setSelectedIngredientItem({
            value: item.id,
            label: `${item.type} (${item.batchCode})`,
          });
          setAmountModalVisible(true);
        }}
      >
        <Text style={styles.removeButtonText}>Add</Text>
      </TouchableOpacity>
    </View>
  );

  const renderRecipeIngredient = ({ item }) => (
    <View style={[styles.stockItem, { backgroundColor: "#FFF9C4" }]}>
      <View style={styles.stockDetails}>
        <Text style={styles.stockType}>
          {item.type === "dry"
            ? "Dry Good"
            : item.type === "carcass"
              ? "Carcass"
              : "Custom"}
        </Text>
        <Text style={styles.stockInfo}>{item.itemName}</Text>
        <Text style={styles.stockInfo}>
          {item.amountPerPiece.toFixed(6)} kg/piece
        </Text>
      </View>
      <TouchableOpacity
        style={[styles.removeButton, { backgroundColor: "#FF4444" }]}
        onPress={() => removeIngredient(item.id)}
      >
        <Text style={styles.removeButtonText}>Remove</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <Modal
      animationType="slide"
      transparent={false}
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, backgroundColor: "#F9F9F9" }}>
        <TouchableOpacity style={styles.backButton} onPress={onClose}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
          <View style={styles.dryGoodsContainer}>
            <Text style={styles.dryGoodsTitle}>Create Recipe</Text>
            <TextInput
              style={styles.inputField}
              placeholder="Product Name (e.g., Beef Sausage)"
              value={recipeName}
              onChangeText={setRecipeName}
            />
            <TextInput
              style={styles.inputField}
              placeholder="Pack Size (g) e.g., 500"
              keyboardType="decimal-pad"
              value={packSize}
              onChangeText={setPackSize}
            />
            <TextInput
              style={styles.inputField}
              placeholder="Pieces per Pack"
              keyboardType="numeric"
              value={piecesPerPack}
              onChangeText={setPiecesPerPack}
            />
            {pieceWeight > 0 && (
              <View style={styles.recipeSummary}>
                <Text style={styles.recordsHeader}>Calculated Values:</Text>
                <Text style={styles.stockInfo}>
                  Piece Weight: {pieceWeight.toFixed(6)} kg (
                  {pieceWeight * 1000} g)
                </Text>
                <Text style={styles.stockInfo}>
                  Pack Weight:{" "}
                  {(pieceWeight * (parseInt(piecesPerPack) || 0)).toFixed(6)} kg
                </Text>
              </View>
            )}

            {/* Custom Ingredient Section */}
            <Text style={[styles.sectionHeader, { marginTop: 20 }]}>
              ➕ Add Custom Ingredient (not in stock)
            </Text>
            <TextInput
              style={styles.inputField}
              placeholder="Ingredient name (e.g., Spices Mix)"
              value={customName}
              onChangeText={setCustomName}
            />
            <TextInput
              style={styles.inputField}
              placeholder="Amount per piece (kg)"
              keyboardType="decimal-pad"
              value={customAmount}
              onChangeText={setCustomAmount}
            />
            <TouchableOpacity
              style={[
                styles.saveButton,
                { backgroundColor: "#4CAF50", marginTop: 0, marginBottom: 10 },
              ]}
              onPress={addCustomIngredient}
            >
              <Text style={styles.saveButtonText}>Add Custom Ingredient</Text>
            </TouchableOpacity>

            <Text style={styles.sectionHeader}>
              Select from Dry Goods (in stock)
            </Text>
            <TextInput
              style={styles.searchInput}
              placeholder="Search dry goods..."
              value={dryGoodsSearchText}
              onChangeText={setDryGoodsSearchText}
            />
            <FlatList
              data={filteredDryGoods}
              keyExtractor={(item) => item.value}
              renderItem={renderDryGoodsItem}
              ListEmptyComponent={
                <Text style={styles.emptyText}>No dry goods</Text>
              }
              scrollEnabled={false}
              keyboardShouldPersistTaps="handled"
            />

            <Text style={styles.sectionHeader}>
              Select from Carcass (in stock)
            </Text>
            <TextInput
              style={styles.searchInput}
              placeholder="Search carcass..."
              value={carcassSearchText}
              onChangeText={setCarcassSearchText}
            />
            <FlatList
              data={filteredCarcass}
              keyExtractor={(item) => item.id}
              renderItem={renderCarcassItem}
              ListEmptyComponent={
                <Text style={styles.emptyText}>No carcass</Text>
              }
              scrollEnabled={false}
              keyboardShouldPersistTaps="handled"
            />

            {recipeItems.length > 0 && (
              <>
                <Text style={styles.recordsHeader}>
                  Recipe Ingredients ({recipeItems.length})
                </Text>
                <FlatList
                  data={recipeItems}
                  keyExtractor={(item) => item.id}
                  renderItem={renderRecipeIngredient}
                  scrollEnabled={false}
                  keyboardShouldPersistTaps="handled"
                />
              </>
            )}

            <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
              <Text style={styles.saveButtonText}>Save Recipe</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
      <AddAmountModal
        visible={amountModalVisible}
        item={selectedIngredientItem}
        onAdd={(amount) =>
          addIngredient(selectedIngredientType, selectedIngredientItem, amount)
        }
        onClose={() => {
          setAmountModalVisible(false);
          setSelectedIngredientItem(null);
        }}
      />
    </Modal>
  );
};

// ============ DELETE RECIPE MODAL ============
const DeleteRecipeModal = ({ visible, recipe, onConfirm, onClose }) => {
  const [confirmationText, setConfirmationText] = useState("");

  useEffect(() => {
    if (!visible) setConfirmationText("");
  }, [visible]);

  const handleConfirm = () => {
    if (confirmationText.toLowerCase() === "delete") {
      onConfirm();
      setConfirmationText("");
    } else {
      ToastAndroid.show('Type "delete" to confirm', ToastAndroid.SHORT);
    }
  };

  return (
    <Modal
      animationType="fade"
      transparent={true}
      visible={visible}
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.modalOverlay}>
          <TouchableWithoutFeedback>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Delete Recipe</Text>
              <Text style={styles.modalSubtitle}>
                Recipe: {recipe?.name || ""}
              </Text>
              <Text style={[styles.modalSubtitle, { color: "#CC0000" }]}>
                This action cannot be undone.
              </Text>
              <Text style={styles.modalSubtitle}>
                Type "delete" to confirm:
              </Text>
              <TextInput
                style={styles.inputField}
                placeholder='Type "delete"'
                value={confirmationText}
                onChangeText={setConfirmationText}
                autoCapitalize="none"
              />
              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={[styles.modalButton, { backgroundColor: "#FF4444" }]}
                  onPress={handleConfirm}
                >
                  <Text style={styles.modalButtonText}>Delete</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalButton, { backgroundColor: "#888" }]}
                  onPress={onClose}
                >
                  <Text style={styles.modalButtonText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

// ============ SELECT BATCH MODAL ============
const SelectBatchModal = ({ visible, batches, onSelect, onClose }) => {
  const [searchText, setSearchText] = useState("");
  const [filteredBatches, setFilteredBatches] = useState(batches);

  useEffect(() => {
    if (searchText.trim() === "") {
      setFilteredBatches(batches);
    } else {
      setFilteredBatches(
        batches.filter(
          (batch) =>
            batch.batchCode.toLowerCase().includes(searchText.toLowerCase()) ||
            batch.productName.toLowerCase().includes(searchText.toLowerCase()),
        ),
      );
    }
  }, [searchText, batches]);

  const renderBatchItem = ({ item }) => (
    <TouchableOpacity style={styles.stockItem} onPress={() => onSelect(item)}>
      <View style={styles.stockDetails}>
        <Text style={styles.stockType}>{item.productName}</Text>
        <Text style={styles.stockInfo}>Batch: {item.batchCode}</Text>
        <Text style={styles.stockInfo}>
          Total Pieces: {item.totalPieces} | Packed: {item.packedPieces || 0}
        </Text>
        <Text style={styles.stockInfo}>
          Remaining: {item.remainingPieces} pieces
        </Text>
        <Text style={styles.stockDate}>Created: {item.timestamp}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <Modal
      animationType="slide"
      transparent={false}
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, backgroundColor: "#F9F9F9" }}>
        <TouchableOpacity style={styles.backButton} onPress={onClose}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <View style={styles.dryGoodsContainer}>
          <Text style={styles.dryGoodsTitle}>Select Processing Batch</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search by product or batch code..."
            value={searchText}
            onChangeText={setSearchText}
          />
          <FlatList
            data={filteredBatches}
            keyExtractor={(item) => item.id}
            renderItem={renderBatchItem}
            ListEmptyComponent={
              <Text style={styles.emptyText}>
                No processing batches available
              </Text>
            }
          />
        </View>
      </View>
    </Modal>
  );
};

// ============ PACKING SCREEN ============
const PackingScreen = ({ onClose }) => {
  const [processingBatches, setProcessingBatches] = useState([]);
  const [filteredBatches, setFilteredBatches] = useState([]);
  const [searchText, setSearchText] = useState("");
  const [selectedBatch, setSelectedBatch] = useState(null);
  const [piecesToPack, setPiecesToPack] = useState("");
  const [packingRecords, setPackingRecords] = useState([]);
  const [filteredRecords, setFilteredRecords] = useState([]);
  const [recordsSearchText, setRecordsSearchText] = useState("");
  const [packedProducts, setPackedProducts] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [packCounter, setPackCounter] = useState(1);

  useEffect(() => {
    loadProcessingBatches();
    loadPackingRecords();
    loadPackedProducts();
    loadPackCounter();
  }, []);

  useEffect(() => {
    if (searchText.trim() === "") {
      setFilteredBatches(processingBatches);
    } else {
      setFilteredBatches(
        processingBatches.filter(
          (batch) =>
            batch.productName
              ?.toLowerCase()
              .includes(searchText.toLowerCase()) ||
            batch.batchCode?.toLowerCase().includes(searchText.toLowerCase()),
        ),
      );
    }
  }, [searchText, processingBatches]);

  useEffect(() => {
    if (recordsSearchText.trim() === "") {
      setFilteredRecords(packingRecords);
    } else {
      setFilteredRecords(
        packingRecords.filter(
          (record) =>
            record.productName
              ?.toLowerCase()
              .includes(recordsSearchText.toLowerCase()) ||
            record.batchCode
              ?.toLowerCase()
              .includes(recordsSearchText.toLowerCase()),
        ),
      );
    }
  }, [recordsSearchText, packingRecords]);

  const loadPackCounter = async () => {
    try {
      const stored = await AsyncStorage.getItem("@pack_counter");
      if (stored) setPackCounter(parseInt(stored));
    } catch (error) {
      console.error("Failed to load pack counter", error);
    }
  };

  const savePackCounter = async (counter) => {
    try {
      await AsyncStorage.setItem("@pack_counter", counter.toString());
    } catch (error) {
      console.error("Failed to save pack counter", error);
    }
  };

  const loadProcessingBatches = async () => {
    try {
      const stored = await AsyncStorage.getItem(PROCESSING_RECORDS_KEY);
      if (stored) {
        let batches = JSON.parse(stored);
        batches = batches.filter(
          (batch) =>
            batch.status !== "Fully Packed" && batch.remainingPieces > 0,
        );
        setProcessingBatches(batches);
        setFilteredBatches(batches);
      }
    } catch (error) {
      console.error("Failed to load processing batches", error);
    }
  };

  const loadPackingRecords = async () => {
    try {
      const stored = await AsyncStorage.getItem(PACKING_RECORDS_KEY);
      if (stored) {
        const records = JSON.parse(stored);
        setPackingRecords(records);
        setFilteredRecords(records);
      }
    } catch (error) {
      console.error("Failed to load packing records", error);
    }
  };

  const loadPackedProducts = async () => {
    try {
      const stored = await AsyncStorage.getItem(PACKED_PRODUCTS_KEY);
      if (stored) setPackedProducts(JSON.parse(stored));
    } catch (error) {
      console.error("Failed to load packed products", error);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      loadProcessingBatches(),
      loadPackingRecords(),
      loadPackedProducts(),
    ]);
    setRefreshing(false);
  };

  const handlePack = () => {
    if (!selectedBatch) {
      ToastAndroid.show("Please select a processing batch", ToastAndroid.SHORT);
      return;
    }
    const pieces = parseInt(piecesToPack);
    if (isNaN(pieces) || pieces <= 0) {
      ToastAndroid.show(
        "Please enter valid number of pieces",
        ToastAndroid.SHORT,
      );
      return;
    }
    if (pieces > selectedBatch.remainingPieces) {
      ToastAndroid.show(
        `Only ${selectedBatch.remainingPieces} pieces available`,
        ToastAndroid.SHORT,
      );
      return;
    }
    const packsProduced = Math.floor(pieces / selectedBatch.piecesPerPack);
    const remainingPieces = pieces % selectedBatch.piecesPerPack;
    Alert.alert(
      "Confirm Packing",
      `Product: ${selectedBatch.productName}\nPieces to pack: ${pieces}\nPacks produced: ${packsProduced}\nRemaining pieces: ${remainingPieces}\n\nProceed with packing?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Confirm",
          onPress: () => confirmPack(pieces, packsProduced, remainingPieces),
        },
      ],
    );
  };

  const confirmPack = async (pieces, packsProduced, remainingPieces) => {
    try {
      const packBatchNumbers = [];
      for (let i = 0; i < packsProduced; i++) {
        const packNumber = packCounter + i;
        packBatchNumbers.push(
          formatPackBatchNumber(selectedBatch.productName, packNumber),
        );
      }
      const packingRecord = {
        id: Date.now().toString(),
        processingBatchId: selectedBatch.id,
        processingBatchCode: selectedBatch.batchCode,
        productName: selectedBatch.productName,
        packSize: selectedBatch.packSize,
        piecesPerPack: selectedBatch.piecesPerPack,
        piecesPacked: pieces,
        packsProduced: packsProduced,
        remainingPieces: remainingPieces,
        packBatchNumbers: packBatchNumbers,
        timestamp: new Date().toLocaleString(),
        date: new Date().toISOString(),
      };
      const existingRecords = await AsyncStorage.getItem(PACKING_RECORDS_KEY);
      let records = existingRecords ? JSON.parse(existingRecords) : [];
      records.unshift(packingRecord);
      await AsyncStorage.setItem(PACKING_RECORDS_KEY, JSON.stringify(records));
      syncToFirebase(
        "packingRecords",
        packingRecord,
        store.getState().settings.BusinessId,
      );
      const processingStored = await AsyncStorage.getItem(
        PROCESSING_RECORDS_KEY,
      );
      let processingBatchesList = processingStored
        ? JSON.parse(processingStored)
        : [];
      const batchIndex = processingBatchesList.findIndex(
        (b) => b.id === selectedBatch.id,
      );
      if (batchIndex !== -1) {
        processingBatchesList[batchIndex].packedPieces =
          (processingBatchesList[batchIndex].packedPieces || 0) + pieces;
        processingBatchesList[batchIndex].remainingPieces =
          processingBatchesList[batchIndex].totalPieces -
          processingBatchesList[batchIndex].packedPieces;
        if (processingBatchesList[batchIndex].remainingPieces <= 0) {
          processingBatchesList[batchIndex].status = "Fully Packed";
        } else {
          processingBatchesList[batchIndex].status = "Partially Packed";
        }
        await AsyncStorage.setItem(
          PROCESSING_RECORDS_KEY,
          JSON.stringify(processingBatchesList),
        );
      }
      const packedProductsList = [...packedProducts];
      for (const packBatch of packBatchNumbers) {
        packedProductsList.push({
          id: Date.now().toString() + Math.random(),
          productName: selectedBatch.productName,
          packSize: selectedBatch.packSize,
          piecesPerPack: selectedBatch.piecesPerPack,
          packBatchNumber: packBatch,
          processingBatchCode: selectedBatch.batchCode,
          timestamp: new Date().toLocaleString(),
          date: new Date().toISOString(),
          status: "In Stock",
        });
      }
      await AsyncStorage.setItem(
        PACKED_PRODUCTS_KEY,
        JSON.stringify(packedProductsList),
      );
      const newPackCounter = packCounter + packsProduced;
      setPackCounter(newPackCounter);
      await savePackCounter(newPackCounter);
      ToastAndroid.show(
        `Packed ${packsProduced} packs (${pieces} pieces)`,
        ToastAndroid.LONG,
      );
      setSelectedBatch(null);
      setPiecesToPack("");
      onRefresh();
    } catch (error) {
      console.error("Failed to save packing record", error);
      ToastAndroid.show("Error saving packing record", ToastAndroid.SHORT);
    }
  };

  const renderProcessingBatch = ({ item }) => (
    <TouchableOpacity
      style={[
        styles.stockItem,
        { backgroundColor: selectedBatch?.id === item.id ? "#D4E8FF" : "#FFF" },
      ]}
      onPress={() => setSelectedBatch(item)}
    >
      <View style={styles.stockDetails}>
        <Text style={styles.stockType}>{item.productName}</Text>
        <Text style={styles.stockInfo}>Batch: {item.batchCode}</Text>
        <Text style={styles.stockInfo}>Pack Size: {item.packSize}g</Text>
        <Text style={styles.stockInfo}>
          Pieces per Pack: {item.piecesPerPack}
        </Text>
        <Text style={styles.stockInfo}>
          Total Pieces: {item.totalPieces} | Packed: {item.packedPieces || 0}
        </Text>
        <Text style={styles.stockInfo}>
          Remaining: {item.remainingPieces} pieces
        </Text>
        <Text style={styles.stockInfo}>
          Status: {item.status || "Ready for packing"}
        </Text>
        <Text style={styles.stockDate}>Created: {item.timestamp}</Text>
      </View>
      {selectedBatch?.id === item.id && (
        <View style={[styles.removeButton, { backgroundColor: "#4CAF50" }]}>
          <Text style={styles.removeButtonText}>Selected</Text>
        </View>
      )}
    </TouchableOpacity>
  );

  const renderPackingRecord = ({ item }) => (
    <View style={[styles.stockItem, { backgroundColor: "#E8F4FD" }]}>
      <View style={styles.stockDetails}>
        <Text style={styles.stockType}>{item.productName}</Text>
        <Text style={styles.stockInfo}>
          Processing Batch: {item.processingBatchCode}
        </Text>
        <Text style={styles.stockInfo}>
          {item.piecesPacked} pieces → {item.packsProduced} packs
        </Text>
        <Text style={styles.stockInfo}>
          Remaining pieces: {item.remainingPieces}
        </Text>
        <Text style={styles.stockInfo}>
          Pack Batch Nos: {item.packBatchNumbers.join(", ")}
        </Text>
        <Text style={styles.stockDate}>Packed: {item.timestamp}</Text>
      </View>
    </View>
  );

  const renderPackedProduct = ({ item }) => (
    <View style={[styles.stockItem, { backgroundColor: "#F0FFF0" }]}>
      <View style={styles.stockDetails}>
        <Text style={styles.stockType}>{item.productName}</Text>
        <Text style={styles.stockInfo}>Pack Batch: {item.packBatchNumber}</Text>
        <Text style={styles.stockInfo}>
          {item.packSize}g - {item.piecesPerPack} pcs/pack
        </Text>
        <Text style={styles.stockInfo}>From: {item.processingBatchCode}</Text>
        <Text style={styles.stockInfo}>Status: {item.status}</Text>
        <Text style={styles.stockDate}>Packed: {item.timestamp}</Text>
      </View>
    </View>
  );

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: "#F9F9F9" }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.dryGoodsContainer}>
        <TouchableOpacity style={styles.backButton} onPress={onClose}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.dryGoodsTitle}>Packing Section</Text>
        <TouchableOpacity style={styles.refreshButtonSmall} onPress={onRefresh}>
          <Text style={styles.refreshButtonSmallText}>↻ Refresh</Text>
        </TouchableOpacity>
        <Text style={styles.sectionHeader}>
          Processing Batches Ready for Packing
        </Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Search by product or batch..."
          value={searchText}
          onChangeText={setSearchText}
        />
        <FlatList
          data={filteredBatches}
          keyExtractor={(item) => item.id}
          renderItem={renderProcessingBatch}
          ListEmptyComponent={
            <Text style={styles.emptyText}>
              No processing batches available for packing
            </Text>
          }
          scrollEnabled={false}
        />
        {selectedBatch && (
          <>
            <Text style={styles.sectionHeader}>Pack Configuration</Text>
            <View style={styles.recipeSummary}>
              <Text style={styles.stockInfo}>
                Selected: {selectedBatch.productName}
              </Text>
              <Text style={styles.stockInfo}>
                Pack Size: {selectedBatch.packSize}g
              </Text>
              <Text style={styles.stockInfo}>
                Pieces per Pack: {selectedBatch.piecesPerPack}
              </Text>
              <Text style={styles.stockInfo}>
                Available pieces: {selectedBatch.remainingPieces}
              </Text>
            </View>
            <TextInput
              style={styles.inputField}
              placeholder="Number of pieces to pack"
              keyboardType="numeric"
              value={piecesToPack}
              onChangeText={setPiecesToPack}
            />
            {piecesToPack && parseInt(piecesToPack) > 0 && (
              <View style={styles.recipeSummary}>
                <Text style={styles.recordsHeader}>Calculated Output:</Text>
                <Text style={styles.stockInfo}>
                  Packs produced:{" "}
                  {Math.floor(
                    parseInt(piecesToPack) / selectedBatch.piecesPerPack,
                  )}
                </Text>
                <Text style={styles.stockInfo}>
                  Remaining pieces:{" "}
                  {parseInt(piecesToPack) % selectedBatch.piecesPerPack}
                </Text>
              </View>
            )}
            <TouchableOpacity style={styles.saveButton} onPress={handlePack}>
              <Text style={styles.saveButtonText}>Process Packing</Text>
            </TouchableOpacity>
          </>
        )}
        <Text style={styles.recordsHeader}>Packing History</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Search records..."
          value={recordsSearchText}
          onChangeText={setRecordsSearchText}
        />
        <FlatList
          data={filteredRecords}
          keyExtractor={(item) => item.id}
          renderItem={renderPackingRecord}
          ListEmptyComponent={
            <Text style={styles.emptyText}>No packing records yet</Text>
          }
          scrollEnabled={false}
        />
        <Text style={styles.recordsHeader}>
          Packed Products Inventory ({packedProducts.length})
        </Text>
        <FlatList
          data={packedProducts}
          keyExtractor={(item) => item.id}
          renderItem={renderPackedProduct}
          ListEmptyComponent={
            <Text style={styles.emptyText}>No packed products yet</Text>
          }
          scrollEnabled={false}
        />
        <View style={{ height: responsiveSize(20) }} />
      </View>
    </ScrollView>
  );
};

// ============ PROCESSING SCREEN (FIXED: full auto-refresh) ============
const ProcessingScreen = ({ onClose }) => {
  const [processingRecords, setProcessingRecords] = useState([]);
  const [filteredRecords, setFilteredRecords] = useState([]);
  const [searchText, setSearchText] = useState("");
  const [itemToProcess, setItemToProcess] = useState("");
  const [dryGoodsItems, setDryGoodsItems] = useState([]);
  const [selectedDryGoods, setSelectedDryGoods] = useState([]);
  const [carcassItems, setCarcassItems] = useState([]);
  const [selectedCarcasses, setSelectedCarcasses] = useState([]);
  const [dryGoodsStock, setDryGoodsStock] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [dryGoodsSearchText, setDryGoodsSearchText] = useState("");
  const [filteredDryGoods, setFilteredDryGoods] = useState([]);
  const [carcassSearchText, setCarcassSearchText] = useState("");
  const [filteredCarcass, setFilteredCarcass] = useState([]);
  const [selectedDryGoodsAmounts, setSelectedDryGoodsAmounts] = useState({});
  const [savedRecipes, setSavedRecipes] = useState([]);
  const [filteredRecipes, setFilteredRecipes] = useState([]);
  const [recipeSearchText, setRecipeSearchText] = useState("");
  const [createRecipeModalVisible, setCreateRecipeModalVisible] =
    useState(false);
  const [deleteRecipeModalVisible, setDeleteRecipeModalVisible] =
    useState(false);
  const [recipeToDelete, setRecipeToDelete] = useState(null);
  const [selectedRecipe, setSelectedRecipe] = useState(null);
  const [bulkQuantity, setBulkQuantity] = useState("");
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [productionPieces, setProductionPieces] = useState(1);
  const [processingBatchCounter, setProcessingBatchCounter] = useState(1);
  const [missingIngredientsWarnings, setMissingIngredientsWarnings] = useState(
    {},
  );

  const searchTimer = useRef(null);
  const dryGoodsTimer = useRef(null);
  const carcassTimer = useRef(null);
  const recipeTimer = useRef(null);

  // ----- LOAD ALL DATA (wrapped in useCallback to avoid stale closure) -----
  const loadAllData = useCallback(async () => {
    console.log("🔄 ProcessingScreen: loadAllData() called");
    await Promise.all([
      loadProcessingRecords(),
      loadDryGoodsStock(),
      loadCarcassItems(),
      loadSavedRecipes(),
    ]);
  }, []);

  // ----- LOAD INDIVIDUAL DATA FUNCTIONS -----
  const loadProcessingBatchCounter = async () => {
    try {
      const stored = await AsyncStorage.getItem("@processing_batch_counter");
      if (stored) setProcessingBatchCounter(parseInt(stored));
    } catch (error) {
      console.error("Failed to load processing batch counter", error);
    }
  };

  const saveProcessingBatchCounter = async (counter) => {
    try {
      await AsyncStorage.setItem(
        "@processing_batch_counter",
        counter.toString(),
      );
    } catch (error) {
      console.error("Failed to save processing batch counter", error);
    }
  };

  const loadProcessingRecords = async () => {
    try {
      const stored = await AsyncStorage.getItem(PROCESSING_RECORDS_KEY);
      if (stored) {
        let records = JSON.parse(stored);
        records = records.map((record) => ({
          ...record,
          dryGoodsUsed: record.dryGoodsUsed || [],
          carcassesUsed: record.carcassesUsed || [],
          packedPieces: record.packedPieces || 0,
          remainingPieces:
            (record.totalPieces || 0) - (record.packedPieces || 0),
        }));
        setProcessingRecords(records);
        setFilteredRecords(records);
      }
    } catch (error) {
      console.error("Failed to load processing records", error);
    }
  };

  const loadDryGoodsStock = async () => {
    try {
      const stockKey = getStockKeyForStore("dry");
      const stock = await AsyncStorage.getItem(stockKey);
      if (stock) {
        const stockList = JSON.parse(stock);
        setDryGoodsStock(stockList);
        const items = stockList.map((item) => ({
          label: `${item.type} (${item.totalWeight.toFixed(6)} kg)`,
          value: item.type,
          type: item.type,
          totalWeight: item.totalWeight,
          id: item.id,
        }));
        setDryGoodsItems(items);
        setFilteredDryGoods(items);
      }
    } catch (error) {
      console.error("Failed to load dry goods", error);
    }
  };

  const loadCarcassItems = async () => {
    try {
      const coldStockKey = getStockKeyForStore("cold");
      const coldStock = await AsyncStorage.getItem(coldStockKey);
      if (coldStock) {
        const stockList = JSON.parse(coldStock);
        const debonnedItems = stockList.filter(
          (item) => item.isDebonned === true,
        );
        const items = debonnedItems.map((item) => ({
          id: item.id,
          batchCode: item.batchCode,
          type: item.type,
          currentWeight: item.currentWeight || item.totalWeight,
          originalWeight: item.weightAfterDebonning || item.totalWeight,
        }));
        setCarcassItems(items);
        setFilteredCarcass(items);
      }
    } catch (error) {
      console.error("Failed to load carcass", error);
    }
  };

  const loadSavedRecipes = async () => {
    try {
      const stored = await AsyncStorage.getItem(RECIPES_KEY);
      const recipes = stored ? JSON.parse(stored) : [];
      setSavedRecipes(recipes);
      setFilteredRecipes(recipes);
    } catch (error) {
      console.error("Failed to load recipes", error);
    }
  };

  // ----- MISSING INGREDIENT CALCULATION -----
  const getMissingIngredientsForRecipe = (recipe) => {
    const missing = [];
    for (const ingredient of recipe.items) {
      if (ingredient.type === "dry") {
        const stockItem = dryGoodsStock.find(
          (s) => s.type === ingredient.itemId,
        );
        if (!stockItem || stockItem.totalWeight < ingredient.amountPerPiece) {
          const available = stockItem ? stockItem.totalWeight : 0;
          missing.push({
            name: ingredient.itemName,
            neededPerPiece: ingredient.amountPerPiece,
            available: available,
            type: "dry",
          });
        }
      } else if (ingredient.type === "carcass") {
        const carcassItem = carcassItems.find(
          (c) => c.id === ingredient.itemId,
        );
        if (
          !carcassItem ||
          carcassItem.currentWeight < ingredient.amountPerPiece
        ) {
          const available = carcassItem ? carcassItem.currentWeight : 0;
          missing.push({
            name: ingredient.itemName,
            neededPerPiece: ingredient.amountPerPiece,
            available: available,
            type: "carcass",
          });
        }
      } else if (ingredient.type === "custom") {
        missing.push({
          name: ingredient.itemName,
          neededPerPiece: ingredient.amountPerPiece,
          available: 0,
          type: "custom",
        });
      }
    }
    return missing;
  };

  const calculateMissingIngredientsForAllRecipes = () => {
    const warnings = {};
    for (const recipe of savedRecipes) {
      const missing = getMissingIngredientsForRecipe(recipe);
      if (missing.length > 0) warnings[recipe.id] = missing;
    }
    setMissingIngredientsWarnings(warnings);
  };

  // ----- EFFECTS -----
  // Load data when screen mounts (every time this component is rendered, which happens when navigating to Processing)
  useEffect(() => {
    console.log("ProcessingScreen mounted – reloading all data");
    loadAllData();
    loadProcessingBatchCounter();
  }, [loadAllData]);

  // Re‑calculate missing ingredients whenever stock or recipes change
  useEffect(() => {
    calculateMissingIngredientsForAllRecipes();
  }, [dryGoodsStock, carcassItems, savedRecipes]);

  // Delayed search effects (unchanged)
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      if (searchText.trim() === "") {
        setFilteredRecords(processingRecords);
      } else {
        setFilteredRecords(
          processingRecords.filter((r) =>
            r.productName?.toLowerCase().includes(searchText.toLowerCase()),
          ),
        );
      }
    }, 300);
    return () => searchTimer.current && clearTimeout(searchTimer.current);
  }, [searchText, processingRecords]);

  useEffect(() => {
    if (dryGoodsTimer.current) clearTimeout(dryGoodsTimer.current);
    dryGoodsTimer.current = setTimeout(() => {
      if (dryGoodsSearchText.trim() === "") {
        setFilteredDryGoods(dryGoodsItems);
      } else {
        setFilteredDryGoods(
          dryGoodsItems.filter((i) =>
            i.label.toLowerCase().includes(dryGoodsSearchText.toLowerCase()),
          ),
        );
      }
    }, 300);
    return () => dryGoodsTimer.current && clearTimeout(dryGoodsTimer.current);
  }, [dryGoodsSearchText, dryGoodsItems]);

  useEffect(() => {
    if (carcassTimer.current) clearTimeout(carcassTimer.current);
    carcassTimer.current = setTimeout(() => {
      if (carcassSearchText.trim() === "") {
        setFilteredCarcass(carcassItems);
      } else {
        setFilteredCarcass(
          carcassItems.filter((i) =>
            i.batchCode
              ?.toLowerCase()
              .includes(carcassSearchText.toLowerCase()),
          ),
        );
      }
    }, 300);
    return () => carcassTimer.current && clearTimeout(carcassTimer.current);
  }, [carcassSearchText, carcassItems]);

  useEffect(() => {
    if (recipeTimer.current) clearTimeout(recipeTimer.current);
    recipeTimer.current = setTimeout(() => {
      if (recipeSearchText.trim() === "") {
        setFilteredRecipes(savedRecipes);
      } else {
        setFilteredRecipes(
          savedRecipes.filter((r) =>
            r.name.toLowerCase().includes(recipeSearchText.toLowerCase()),
          ),
        );
      }
    }, 300);
    return () => recipeTimer.current && clearTimeout(recipeTimer.current);
  }, [recipeSearchText, savedRecipes]);

  // ---------- BUSINESS LOGIC FUNCTIONS (keep exactly as in your working code) ----------
  const saveRecipe = async (
    name,
    items,
    packSize,
    piecesPerPack,
    pieceWeight,
  ) => {
    const newRecipe = {
      id: Date.now().toString(),
      name: name,
      items: items,
      packSize: packSize,
      piecesPerPack: piecesPerPack,
      pieceWeight: pieceWeight,
      createdAt: new Date().toLocaleString(),
    };
    const updated = [newRecipe, ...savedRecipes];
    setSavedRecipes(updated);
    setFilteredRecipes(updated);
    await AsyncStorage.setItem(RECIPES_KEY, JSON.stringify(updated));
    syncToFirebase("recipes", newRecipe, store.getState().settings.BusinessId);
    ToastAndroid.show(`Recipe "${name}" saved!`, ToastAndroid.SHORT);
  };

  const deleteRecipe = async () => {
    if (!recipeToDelete) return;
    const updatedRecipes = savedRecipes.filter(
      (r) => r.id !== recipeToDelete.id,
    );
    setSavedRecipes(updatedRecipes);
    setFilteredRecipes(updatedRecipes);
    await AsyncStorage.setItem(RECIPES_KEY, JSON.stringify(updatedRecipes));
    ToastAndroid.show(
      `Recipe "${recipeToDelete.name}" deleted`,
      ToastAndroid.SHORT,
    );
    setDeleteRecipeModalVisible(false);
    setRecipeToDelete(null);
  };

  const checkStockAvailability = (requirements) => {
    const missingItems = [];
    for (const req of requirements.dryGoods || []) {
      const stockItem = dryGoodsStock.find((s) => s.type === req.itemId);
      if (!stockItem || stockItem.totalWeight < req.totalAmount) {
        const available = stockItem ? stockItem.totalWeight : 0;
        missingItems.push({
          name: req.itemName,
          needed: req.totalAmount,
          available: available,
          type: "dry",
        });
      }
    }
    for (const req of requirements.carcasses || []) {
      const carcassItem = carcassItems.find((c) => c.id === req.itemId);
      if (!carcassItem || carcassItem.currentWeight < req.totalAmount) {
        const available = carcassItem ? carcassItem.currentWeight : 0;
        missingItems.push({
          name: req.itemName,
          needed: req.totalAmount,
          available: available,
          type: "carcass",
        });
      }
    }
    for (const req of requirements.custom || []) {
      missingItems.push({
        name: req.itemName,
        needed: req.totalAmount,
        available: 0,
        type: "custom",
      });
    }
    return missingItems;
  };

  const calculateMaxPiecesFromStock = (requirements) => {
    let maxPieces = Infinity;
    for (const req of requirements.dryGoods || []) {
      const stockItem = dryGoodsStock.find((s) => s.type === req.itemId);
      if (stockItem) {
        const maxForItem = Math.floor(
          stockItem.totalWeight / req.amountPerPiece,
        );
        maxPieces = Math.min(maxPieces, maxForItem);
      } else {
        return 0;
      }
    }
    for (const req of requirements.carcasses || []) {
      const carcassItem = carcassItems.find((c) => c.id === req.itemId);
      if (carcassItem) {
        const maxForItem = Math.floor(
          carcassItem.currentWeight / req.amountPerPiece,
        );
        maxPieces = Math.min(maxPieces, maxForItem);
      } else {
        return 0;
      }
    }
    return maxPieces === Infinity ? 0 : maxPieces;
  };

  const useRecipe = (recipe) => {
    setSelectedRecipe(recipe);
    setItemToProcess(recipe.name);
    setIsBulkMode(true);
    setProductionPieces(1);
    setBulkQuantity("");
    ToastAndroid.show(
      `Recipe: ${recipe.name}. Enter quantity.`,
      ToastAndroid.LONG,
    );
  };

  const calculateRecipeRequirements = (quantity) => {
    if (!selectedRecipe) return null;
    const requirements = { dryGoods: [], carcasses: [], custom: [] };
    for (const ing of selectedRecipe.items) {
      const totalAmount = ing.amountPerPiece * quantity;
      if (ing.type === "dry") {
        requirements.dryGoods.push({
          itemId: ing.itemId,
          itemName: ing.itemName,
          amountPerPiece: ing.amountPerPiece,
          totalAmount: totalAmount,
        });
      } else if (ing.type === "carcass") {
        requirements.carcasses.push({
          itemId: ing.itemId,
          itemName: ing.itemName,
          amountPerPiece: ing.amountPerPiece,
          totalAmount: totalAmount,
        });
      } else if (ing.type === "custom") {
        requirements.custom.push({
          itemId: ing.itemId,
          itemName: ing.itemName,
          amountPerPiece: ing.amountPerPiece,
          totalAmount: totalAmount,
        });
      }
    }
    return requirements;
  };

  const applyRecipe = async () => {
    const quantity = parseFloat(productionPieces);
    if (isNaN(quantity) || quantity <= 0) {
      ToastAndroid.show("Enter valid quantity", ToastAndroid.SHORT);
      return;
    }
    const requirements = calculateRecipeRequirements(quantity);
    if (!requirements) return;
    const missingItems = checkStockAvailability(requirements);
    if (missingItems.length > 0) {
      const maxPieces = calculateMaxPiecesFromStock(requirements);
      const maxPacks = Math.floor(maxPieces / selectedRecipe.piecesPerPack);
      const remainingPieces = maxPieces % selectedRecipe.piecesPerPack;
      let message = "Missing ingredients:\n";
      missingItems.forEach((item) => {
        if (item.type === "custom") {
          message += `• ${item.name}: ${item.needed.toFixed(6)} kg (not in stock)\n`;
        } else {
          message += `• ${item.name}: need ${item.needed.toFixed(6)} kg, have ${item.available.toFixed(6)} kg\n`;
        }
      });
      if (maxPieces > 0) {
        message += `\nMaximum possible with current stock: ${maxPieces} pieces (${maxPacks} packs + ${remainingPieces} pieces)`;
        Alert.alert("Insufficient Stock", message, [
          { text: "Cancel", style: "cancel" },
          {
            text: "Continue with Max",
            onPress: () => {
              setProductionPieces(maxPieces);
              setTimeout(() => applyRecipeWithMax(maxPieces), 100);
            },
          },
        ]);
      } else {
        Alert.alert("Missing Ingredients", message, [
          { text: "OK", style: "cancel" },
        ]);
      }
      return;
    }
    proceedWithProduction(quantity, requirements);
  };

  const applyRecipeWithMax = (maxPieces) => {
    const requirements = calculateRecipeRequirements(maxPieces);
    if (requirements) proceedWithProduction(maxPieces, requirements);
  };

  const proceedWithProduction = (quantity, requirements) => {
    setSelectedDryGoods([]);
    setSelectedDryGoodsAmounts({});
    setSelectedCarcasses([]);
    for (const req of requirements.dryGoods) {
      const dryGood = dryGoodsItems.find((d) => d.value === req.itemId);
      if (dryGood) {
        setSelectedDryGoods((prev) =>
          prev.some((d) => d.value === req.itemId) ? prev : [...prev, dryGood],
        );
        setSelectedDryGoodsAmounts((prev) => ({
          ...prev,
          [req.itemId]: req.totalAmount,
        }));
      }
    }
    for (const req of requirements.carcasses) {
      const carcassItem = carcassItems.find((c) => c.id === req.itemId);
      if (carcassItem) {
        setSelectedCarcasses((prev) => [
          ...prev,
          {
            ...carcassItem,
            weightToUse: req.totalAmount,
            originalWeight: carcassItem.currentWeight,
            amountPerPiece: req.amountPerPiece,
            piecesProduced: quantity,
          },
        ]);
      }
    }
    ToastAndroid.show(
      `Applied recipe for ${quantity} pieces`,
      ToastAndroid.SHORT,
    );
    setIsBulkMode(false);
  };

  const addDryGoods = (item) => {
    if (selectedDryGoods.some((dg) => dg.value === item.value)) {
      ToastAndroid.show("Already added", ToastAndroid.SHORT);
      return;
    }
    setSelectedDryGoods([...selectedDryGoods, item]);
    setSelectedDryGoodsAmounts({ ...selectedDryGoodsAmounts, [item.value]: 0 });
  };

  const removeDryGoods = (value) => {
    setSelectedDryGoods(selectedDryGoods.filter((dg) => dg.value !== value));
    const newAmounts = { ...selectedDryGoodsAmounts };
    delete newAmounts[value];
    setSelectedDryGoodsAmounts(newAmounts);
  };

  const updateAmount = (value, amount) => {
    setSelectedDryGoodsAmounts({
      ...selectedDryGoodsAmounts,
      [value]: parseFloat(amount) || 0,
    });
  };

  const addCarcass = (item) => {
    if (selectedCarcasses.some((c) => c.id === item.id)) {
      ToastAndroid.show("Carcass already selected", ToastAndroid.SHORT);
      return;
    }
    setSelectedCarcasses([
      ...selectedCarcasses,
      { ...item, weightToUse: 0, piecesProduced: 1 },
    ]);
  };

  const removeCarcass = (id) => {
    setSelectedCarcasses(selectedCarcasses.filter((c) => c.id !== id));
  };

  const updateCarcassWeight = (id, weight) => {
    setSelectedCarcasses(
      selectedCarcasses.map((c) =>
        c.id === id ? { ...c, weightToUse: parseFloat(weight) || 0 } : c,
      ),
    );
  };

  const handleProcess = async () => {
    if (!itemToProcess.trim()) {
      ToastAndroid.show("Enter product name", ToastAndroid.SHORT);
      return;
    }
    if (selectedDryGoods.length === 0 && selectedCarcasses.length === 0) {
      ToastAndroid.show("Select ingredients", ToastAndroid.SHORT);
      return;
    }
    const totalPiecesProduced =
      selectedCarcasses.reduce((sum, c) => sum + (c.piecesProduced || 1), 0) ||
      1;
    const packSize = selectedRecipe?.packSize || 500;
    const piecesPerPack = selectedRecipe?.piecesPerPack || 22;
    for (const dg of selectedDryGoods) {
      const used = selectedDryGoodsAmounts[dg.value] || 0;
      if (used > 0) {
        const dryStockKey = getStockKeyForStore("dry");
        const dryStock = await AsyncStorage.getItem(dryStockKey);
        let list = dryStock ? JSON.parse(dryStock) : [];
        const idx = list.findIndex((d) => d.type === dg.value);
        if (idx !== -1) {
          list[idx].totalWeight -= used;
          if (list[idx].totalWeight <= 0) list.splice(idx, 1);
          await AsyncStorage.setItem(dryStockKey, JSON.stringify(list));
        }
      }
    }
    const carcassesUsedDetails = [];
    for (const carcass of selectedCarcasses) {
      const weightUsed = carcass.weightToUse;
      if (weightUsed > 0) {
        const newWeight = carcass.currentWeight - weightUsed;
        const coldStockKey = getStockKeyForStore("cold");
        const coldStock = await AsyncStorage.getItem(coldStockKey);
        let coldStockList = coldStock ? JSON.parse(coldStock) : [];
        const idx = coldStockList.findIndex((c) => c.id === carcass.id);
        if (idx !== -1) {
          coldStockList[idx].currentWeight = newWeight;
          coldStockList[idx].totalWeight = newWeight;
          coldStockList[idx].lastUpdated = new Date().toISOString();
          coldStockList[idx].usedInProcessing = true;
          coldStockList[idx].usedForProduct = itemToProcess;
          coldStockList[idx].weightUsed = weightUsed;
          await AsyncStorage.setItem(
            coldStockKey,
            JSON.stringify(coldStockList),
          );
          carcassesUsedDetails.push({
            id: carcass.id,
            batchCode: carcass.batchCode,
            type: carcass.type,
            originalWeight: carcass.originalWeight,
            weightUsed: weightUsed,
            remainingWeight: newWeight,
            amountPerPiece: carcass.amountPerPiece || null,
            piecesProduced: carcass.piecesProduced || 1,
          });
        }
      }
    }
    const batchCode = formatProcessingBatchCode(
      itemToProcess,
      processingBatchCounter,
    );
    const newBatchCounter = processingBatchCounter + 1;
    setProcessingBatchCounter(newBatchCounter);
    await saveProcessingBatchCounter(newBatchCounter);
    const record = {
      id: Date.now().toString(),
      productName: itemToProcess,
      packSize: packSize,
      piecesPerPack: piecesPerPack,
      totalPieces: totalPiecesProduced,
      packedPieces: 0,
      remainingPieces: totalPiecesProduced,
      batchCode: batchCode,
      recipeUsed: selectedRecipe?.name || null,
      dryGoodsUsed: selectedDryGoods.map((dg) => ({
        name: dg.label,
        amount: selectedDryGoodsAmounts[dg.value] || 0,
      })),
      carcassesUsed: carcassesUsedDetails,
      timestamp: new Date().toLocaleString(),
      date: new Date().toISOString(),
      status: "Ready for packing",
    };
    const stored = await AsyncStorage.getItem(PROCESSING_RECORDS_KEY);
    let records = stored ? JSON.parse(stored) : [];
    records.unshift(record);
    await AsyncStorage.setItem(PROCESSING_RECORDS_KEY, JSON.stringify(records));
    syncToFirebase(
      "processingRecords",
      record,
      store.getState().settings.BusinessId,
    );
    const packsEquivalent = Math.floor(totalPiecesProduced / piecesPerPack);
    const remainingPiecesTotal = totalPiecesProduced % piecesPerPack;
    ToastAndroid.show(
      `Processed: ${itemToProcess}\nTotal pieces: ${totalPiecesProduced}\nEquivalent packs: ${packsEquivalent} packs + ${remainingPiecesTotal} pieces\nBatch: ${batchCode}`,
      ToastAndroid.LONG,
    );
    setItemToProcess("");
    setSelectedDryGoods([]);
    setSelectedDryGoodsAmounts({});
    setSelectedCarcasses([]);
    setProductionPieces(1);
    setSelectedRecipe(null);
    loadAllData();
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadAllData();
    setRefreshing(false);
  };

  const renderRecipeItem = ({ item }) => {
    const missingIngredients = missingIngredientsWarnings[item.id] || [];
    const hasMissingIngredients = missingIngredients.length > 0;
    return (
      <View
        style={[
          styles.stockItem,
          {
            backgroundColor: "#E8F4FD",
            flexDirection: "column",
            alignItems: "stretch",
          },
        ]}
      >
        <TouchableOpacity onPress={() => useRecipe(item)} style={{ flex: 1 }}>
          <View style={styles.stockDetails}>
            <Text style={styles.stockType}>{item.name}</Text>
            <Text style={styles.stockInfo}>
              Pack: {item.packSize}g - {item.piecesPerPack} pcs/pack
            </Text>
            <Text style={styles.stockInfo}>
              Piece weight: {(item.pieceWeight * 1000).toFixed(2)}g
            </Text>
            <Text style={styles.stockInfo}>
              {item.items.length} ingredients
            </Text>
            {item.items.slice(0, 2).map((ing, idx) => (
              <Text key={idx} style={styles.stockInfo}>
                • {ing.itemName}: {ing.amountPerPiece.toFixed(6)} kg
              </Text>
            ))}
            <Text style={styles.stockDate}>Created: {item.createdAt}</Text>
            {hasMissingIngredients && (
              <View
                style={[
                  styles.recipeSummary,
                  { backgroundColor: "#FFE0E0", marginTop: 8 },
                ]}
              >
                <Text
                  style={[
                    styles.stockInfo,
                    { color: "#CC0000", fontWeight: "bold" },
                  ]}
                >
                  ⚠️ Missing Ingredients:
                </Text>
                {missingIngredients.map((missing, idx) => (
                  <Text
                    key={idx}
                    style={[
                      styles.stockInfo,
                      { color: "#CC0000", marginLeft: 8 },
                    ]}
                  >
                    • {missing.name}: Need {missing.neededPerPiece.toFixed(6)}{" "}
                    kg/piece, Available: {missing.available.toFixed(6)} kg
                  </Text>
                ))}
                <Text
                  style={[
                    styles.stockInfo,
                    { color: "#CC0000", marginTop: 4, fontSize: 12 },
                  ]}
                >
                  Please add these ingredients to stock before processing.
                </Text>
              </View>
            )}
          </View>
        </TouchableOpacity>
        <View style={{ flexDirection: "row", marginTop: 8 }}>
          <TouchableOpacity
            style={[
              styles.removeButton,
              { backgroundColor: "#4CAF50", marginRight: 8, flex: 1 },
            ]}
            onPress={() => useRecipe(item)}
          >
            <Text style={styles.removeButtonText}>Use</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.removeButton,
              { backgroundColor: "#FF4444", flex: 1 },
            ]}
            onPress={() => {
              setRecipeToDelete(item);
              setDeleteRecipeModalVisible(true);
            }}
          >
            <Text style={styles.removeButtonText}>Delete</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderDryGoodsItem = ({ item }) => (
    <View style={styles.stockItem}>
      <View style={styles.stockDetails}>
        <Text style={styles.stockType}>{item.label}</Text>
      </View>
      <TouchableOpacity
        style={[styles.removeButton, { backgroundColor: "#0066CC" }]}
        onPress={() => addDryGoods(item)}
      >
        <Text style={styles.removeButtonText}>Add</Text>
      </TouchableOpacity>
    </View>
  );

  const renderSelectedDryGoodsItem = ({ item }) => (
    <View style={[styles.stockItem, { backgroundColor: "#E8F4FD" }]}>
      <View style={styles.stockDetails}>
        <Text style={styles.stockType}>{item.label}</Text>
        <TextInput
          style={[styles.inputField, { marginTop: 5, height: 40 }]}
          placeholder="Amount (kg)"
          keyboardType="decimal-pad"
          value={selectedDryGoodsAmounts[item.value]?.toString() || ""}
          onChangeText={(text) => updateAmount(item.value, text)}
        />
      </View>
      <TouchableOpacity
        style={[styles.removeButton, { backgroundColor: "#FF4444" }]}
        onPress={() => removeDryGoods(item.value)}
      >
        <Text style={styles.removeButtonText}>Remove</Text>
      </TouchableOpacity>
    </View>
  );

  const renderCarcassItem = ({ item }) => (
    <View style={[styles.stockItem, { backgroundColor: "#FFF3E0" }]}>
      <View style={styles.stockDetails}>
        <Text style={styles.stockType}>{item.type}</Text>
        <Text style={styles.stockInfo}>Batch: {item.batchCode}</Text>
        <Text style={styles.stockInfo}>
          Available: {item.currentWeight?.toFixed(6)} kg
        </Text>
      </View>
      <TouchableOpacity
        style={[styles.removeButton, { backgroundColor: "#FFA500" }]}
        onPress={() => addCarcass(item)}
      >
        <Text style={styles.removeButtonText}>Add</Text>
      </TouchableOpacity>
    </View>
  );

  const renderSelectedCarcassItem = ({ item }) => (
    <View style={[styles.stockItem, { backgroundColor: "#90EE90" }]}>
      <View style={styles.stockDetails}>
        <Text style={styles.stockType}>{item.type}</Text>
        <Text style={styles.stockInfo}>Batch: {item.batchCode}</Text>
        <Text style={styles.stockInfo}>
          Available: {item.currentWeight?.toFixed(6)} kg
        </Text>
        <TextInput
          style={[styles.inputField, { marginTop: 5, height: 40 }]}
          placeholder="Weight to use (kg)"
          keyboardType="decimal-pad"
          value={item.weightToUse?.toString() || ""}
          onChangeText={(text) => updateCarcassWeight(item.id, text)}
        />
        <TextInput
          style={[styles.inputField, { marginTop: 5, height: 40 }]}
          placeholder="Pieces to produce from this carcass"
          keyboardType="numeric"
          value={item.piecesProduced?.toString() || "1"}
          onChangeText={(text) => {
            const num = parseInt(text) || 1;
            setSelectedCarcasses(
              selectedCarcasses.map((c) =>
                c.id === item.id ? { ...c, piecesProduced: num } : c,
              ),
            );
          }}
        />
      </View>
      <TouchableOpacity
        style={[styles.removeButton, { backgroundColor: "#FF4444" }]}
        onPress={() => removeCarcass(item.id)}
      >
        <Text style={styles.removeButtonText}>Remove</Text>
      </TouchableOpacity>
    </View>
  );

  const renderRecordItem = ({ item }) => (
    <View style={[styles.stockItem, { backgroundColor: "#E8F4FD" }]}>
      <View style={styles.stockDetails}>
        <Text style={styles.stockType}>Product: {item.productName}</Text>
        <Text style={styles.stockInfo}>Batch: {item.batchCode}</Text>
        <Text style={styles.stockInfo}>
          Pack: {item.packSize}g - {item.piecesPerPack} pcs/pack
        </Text>
        <Text style={styles.stockInfo}>
          📦 Total Pieces Produced: {item.totalPieces || 0}
        </Text>
        <Text style={styles.stockInfo}>
          📦 Equivalent Packs:{" "}
          {Math.floor((item.totalPieces || 0) / (item.piecesPerPack || 22))}
        </Text>
        <Text style={styles.stockInfo}>
          ✅ Packed: {item.packedPieces || 0} pieces
        </Text>
        <Text style={styles.stockInfo}>
          📍 Remaining: {item.remainingPieces} pieces
        </Text>
        <Text style={styles.stockInfo}>
          Status: {item.status || "Ready for packing"}
        </Text>
        {item.recipeUsed && (
          <Text style={styles.stockInfo}>📋 Recipe: {item.recipeUsed}</Text>
        )}
        <Text style={[styles.stockInfo, { fontWeight: "bold", marginTop: 8 }]}>
          🥩 Carcasses Used:
        </Text>
        {(item.carcassesUsed || []).length > 0 ? (
          item.carcassesUsed.map((carcass, idx) => (
            <View key={idx} style={{ marginLeft: 10, marginTop: 4 }}>
              <Text style={styles.stockInfo}>• Batch: {carcass.batchCode}</Text>
              <Text style={styles.stockInfo}> Type: {carcass.type}</Text>
              <Text style={styles.stockInfo}>
                Weight Used: {carcass.weightUsed?.toFixed(6)} kg
              </Text>
              <Text style={styles.stockInfo}>
                Remaining: {carcass.remainingWeight?.toFixed(6)} kg
              </Text>
              {carcass.piecesProduced && (
                <Text style={styles.stockInfo}>
                  Pieces from this carcass: {carcass.piecesProduced}
                </Text>
              )}
            </View>
          ))
        ) : (
          <Text style={styles.stockInfo}> No carcasses used</Text>
        )}
        <Text style={[styles.stockInfo, { fontWeight: "bold", marginTop: 8 }]}>
          📦 Dry Goods Used:
        </Text>
        {(item.dryGoodsUsed || []).length > 0 ? (
          item.dryGoodsUsed.map((dg, idx) => (
            <Text key={idx} style={styles.stockInfo}>
              • {dg.name}: {dg.amount?.toFixed(6)} kg
            </Text>
          ))
        ) : (
          <Text style={styles.stockInfo}> No dry goods used</Text>
        )}
        <Text style={styles.stockDate}>⏰ {item.timestamp}</Text>
      </View>
    </View>
  );

  if (isBulkMode && selectedRecipe) {
    const requirements = calculateRecipeRequirements(productionPieces);
    const missingItems = requirements
      ? checkStockAvailability(requirements)
      : [];
    const maxPieces = requirements
      ? calculateMaxPiecesFromStock(requirements)
      : 0;
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: "#F9F9F9" }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.dryGoodsContainer}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => {
              setIsBulkMode(false);
              setSelectedRecipe(null);
              setProductionPieces(1);
            }}
          >
            <Text style={styles.backButtonText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.dryGoodsTitle}>Bulk Production</Text>
          <Text style={styles.sessionType}>Recipe: {selectedRecipe.name}</Text>
          <View style={styles.recipeSummary}>
            <Text style={styles.recordsHeader}>Product Details:</Text>
            <Text style={styles.stockInfo}>
              Pack Size: {selectedRecipe.packSize}g
            </Text>
            <Text style={styles.stockInfo}>
              Pieces per Pack: {selectedRecipe.piecesPerPack}
            </Text>
            <Text style={styles.stockInfo}>
              Piece Weight: {(selectedRecipe.pieceWeight * 1000).toFixed(2)}g
            </Text>
          </View>
          <View style={styles.recipeSummary}>
            <Text style={styles.recordsHeader}>Ingredients per piece:</Text>
            {selectedRecipe.items.map((item, idx) => (
              <Text key={idx} style={styles.stockInfo}>
                • {item.itemName}: {item.amountPerPiece.toFixed(6)} kg
              </Text>
            ))}
          </View>
          <TextInput
            style={styles.inputField}
            placeholder="Number of pieces to produce"
            keyboardType="numeric"
            value={productionPieces.toString()}
            onChangeText={(text) => setProductionPieces(parseInt(text) || 1)}
          />
          {maxPieces > 0 && productionPieces > maxPieces && (
            <View
              style={[styles.recipeSummary, { backgroundColor: "#FFE0E0" }]}
            >
              <Text style={[styles.stockInfo, { color: "#FF0000" }]}>
                Warning: Only {maxPieces} pieces possible from current stock
              </Text>
            </View>
          )}
          {requirements && (
            <View style={styles.recipeSummary}>
              <Text style={styles.recordsHeader}>
                Total Required for {productionPieces} pieces:
              </Text>
              {requirements.dryGoods.map((item, idx) => {
                const stockItem = dryGoodsStock.find(
                  (s) => s.type === item.itemId,
                );
                const hasStock =
                  stockItem && stockItem.totalWeight >= item.totalAmount;
                return (
                  <Text
                    key={idx}
                    style={[
                      styles.stockInfo,
                      { color: hasStock ? "#333" : "#FF0000" },
                    ]}
                  >
                    📦 {item.itemName}: {item.totalAmount.toFixed(6)} kg{" "}
                    {!hasStock &&
                      `(Only ${stockItem?.totalWeight.toFixed(6) || 0} kg available)`}
                  </Text>
                );
              })}
              {requirements.carcasses.map((item, idx) => {
                const carcassItem = carcassItems.find(
                  (c) => c.id === item.itemId,
                );
                const hasStock =
                  carcassItem && carcassItem.currentWeight >= item.totalAmount;
                return (
                  <Text
                    key={idx}
                    style={[
                      styles.stockInfo,
                      { color: hasStock ? "#333" : "#FF0000" },
                    ]}
                  >
                    🥩 {item.itemName}: {item.totalAmount.toFixed(6)} kg{" "}
                    {!hasStock &&
                      `(Only ${carcassItem?.currentWeight.toFixed(6) || 0} kg available)`}
                  </Text>
                );
              })}
              {requirements.custom.map((item, idx) => (
                <Text
                  key={idx}
                  style={[styles.stockInfo, { color: "#FF0000" }]}
                >
                  🔧 {item.itemName}: {item.totalAmount.toFixed(6)} kg (not in
                  stock – custom ingredient)
                </Text>
              ))}
            </View>
          )}
          {productionPieces > 0 && (
            <View style={styles.recipeSummary}>
              <Text style={styles.recordsHeader}>Production Output:</Text>
              <Text style={styles.stockInfo}>
                Packs produced:{" "}
                {Math.floor(productionPieces / selectedRecipe.piecesPerPack)}
              </Text>
              <Text style={styles.stockInfo}>
                Remaining pieces:{" "}
                {productionPieces % selectedRecipe.piecesPerPack}
              </Text>
            </View>
          )}
          <TouchableOpacity style={styles.saveButton} onPress={applyRecipe}>
            <Text style={styles.saveButtonText}>Apply Recipe</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: "#F9F9F9" }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.dryGoodsContainer}>
        <TouchableOpacity style={styles.backButton} onPress={onClose}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.dryGoodsTitle}>Processing Section</Text>
        <TouchableOpacity style={styles.refreshButtonSmall} onPress={onRefresh}>
          <Text style={styles.refreshButtonSmallText}>↻ Refresh</Text>
        </TouchableOpacity>
        <View style={styles.recipeSection}>
          <View style={styles.recipeHeader}>
            <Text style={styles.sectionHeader}>Product Recipes</Text>
            <TouchableOpacity
              style={[
                styles.saveButton,
                {
                  backgroundColor: "#FFA500",
                  marginTop: 0,
                  marginBottom: 0,
                  paddingVertical: 8,
                  width: "auto",
                  paddingHorizontal: 15,
                },
              ]}
              onPress={() => setCreateRecipeModalVisible(true)}
            >
              <Text style={[styles.saveButtonText, { fontSize: 14 }]}>
                New Recipe
              </Text>
            </TouchableOpacity>
          </View>
          <TextInput
            style={styles.searchInput}
            placeholder="Search recipes..."
            value={recipeSearchText}
            onChangeText={setRecipeSearchText}
          />
          <FlatList
            data={filteredRecipes}
            keyExtractor={(item) => item.id}
            renderItem={renderRecipeItem}
            ListEmptyComponent={
              <Text style={styles.emptyText}>
                No recipes. Tap "New Recipe" to create one.
              </Text>
            }
            scrollEnabled={false}
            keyboardShouldPersistTaps="handled"
          />
        </View>
        <View style={styles.divider} />
        <Text style={styles.sectionHeader}>Manual Processing</Text>
        <TextInput
          style={styles.inputField}
          placeholder="Product name"
          value={itemToProcess}
          onChangeText={setItemToProcess}
        />
        <Text style={styles.sectionHeader}>Dry Goods</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Search dry goods..."
          value={dryGoodsSearchText}
          onChangeText={setDryGoodsSearchText}
        />
        <FlatList
          data={filteredDryGoods}
          keyExtractor={(item) => item.value}
          renderItem={renderDryGoodsItem}
          ListEmptyComponent={
            <Text style={styles.emptyText}>No dry goods</Text>
          }
          scrollEnabled={false}
          keyboardShouldPersistTaps="handled"
        />
        {selectedDryGoods.length > 0 && (
          <>
            <Text style={styles.recordsHeader}>
              Selected Dry Goods (Enter Amounts)
            </Text>
            <FlatList
              data={selectedDryGoods}
              keyExtractor={(item) => item.value}
              renderItem={renderSelectedDryGoodsItem}
              scrollEnabled={false}
              keyboardShouldPersistTaps="handled"
            />
          </>
        )}
        <Text style={styles.sectionHeader}>Carcasses (Debonned Meat)</Text>
        <Text style={styles.instructionText}>
          Select one or more carcasses to use for this product
        </Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Search by batch..."
          value={carcassSearchText}
          onChangeText={setCarcassSearchText}
        />
        <FlatList
          data={filteredCarcass}
          keyExtractor={(item) => item.id}
          renderItem={renderCarcassItem}
          ListEmptyComponent={
            <Text style={styles.emptyText}>No carcasses available</Text>
          }
          scrollEnabled={false}
          keyboardShouldPersistTaps="handled"
        />
        {selectedCarcasses.length > 0 && (
          <>
            <Text style={styles.recordsHeader}>
              Selected Carcasses ({selectedCarcasses.length})
            </Text>
            <FlatList
              data={selectedCarcasses}
              keyExtractor={(item) => item.id}
              renderItem={renderSelectedCarcassItem}
              scrollEnabled={false}
              keyboardShouldPersistTaps="handled"
            />
          </>
        )}
        <TouchableOpacity style={styles.saveButton} onPress={handleProcess}>
          <Text style={styles.saveButtonText}>Record Processing</Text>
        </TouchableOpacity>
        <Text style={styles.recordsHeader}>
          Processing History ({processingRecords.length})
        </Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Search records..."
          value={searchText}
          onChangeText={setSearchText}
        />
        <FlatList
          data={filteredRecords}
          keyExtractor={(item) => item.id}
          renderItem={renderRecordItem}
          ListEmptyComponent={<Text style={styles.emptyText}>No records</Text>}
          scrollEnabled={false}
          keyboardShouldPersistTaps="handled"
        />
        <View style={{ height: responsiveSize(20) }} />
      </View>
      <CreateRecipeModal
        visible={createRecipeModalVisible}
        onClose={() => setCreateRecipeModalVisible(false)}
        onSave={saveRecipe}
        dryGoodsItems={dryGoodsItems}
        carcassItems={carcassItems}
      />
      <DeleteRecipeModal
        visible={deleteRecipeModalVisible}
        recipe={recipeToDelete}
        onConfirm={deleteRecipe}
        onClose={() => {
          setDeleteRecipeModalVisible(false);
          setRecipeToDelete(null);
        }}
      />
    </ScrollView>
  );
};

// ============ BUTCHERY WEIGHT BEFORE SCREEN ============
const WeightBeforeScreen = ({ onClose, onBatchCreated }) => {
  const [carcassBatches, setCarcassBatches] = useState([]);
  const [filteredBatches, setFilteredBatches] = useState([]);
  const [searchText, setSearchText] = useState("");
  const [selectedBatch, setSelectedBatch] = useState(null);
  const [scaleData, setScaleData] = useState({
    reading: null,
    isStable: false,
  });
  const { receivedData } = useBluetooth();
  const [isWeighing, setIsWeighing] = useState(false);
  const [currentWeight, setCurrentWeight] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [spoilageRemovals, setSpoilageRemovals] = useState([]);
  const [filteredSpoilage, setFilteredSpoilage] = useState([]);
  const [spoilageSearchText, setSpoilageSearchText] = useState("");

  useEffect(() => {
    loadCarcassBatches();
    loadSpoilageRemovals();
  }, []);

  useEffect(() => {
    if (searchText.trim() === "") {
      setFilteredBatches(carcassBatches);
    } else {
      const filtered = carcassBatches.filter(
        (item) =>
          item.batchCode &&
          item.batchCode
            .slice(-3)
            .toLowerCase()
            .includes(searchText.toLowerCase()),
      );
      setFilteredBatches(filtered);
    }
  }, [searchText, carcassBatches]);

  useEffect(() => {
    if (spoilageSearchText.trim() === "") {
      setFilteredSpoilage(spoilageRemovals);
    } else {
      const filtered = spoilageRemovals.filter(
        (item) =>
          item.batchCode &&
          item.batchCode
            .slice(-3)
            .toLowerCase()
            .includes(spoilageSearchText.toLowerCase()),
      );
      setFilteredSpoilage(filtered);
    }
  }, [spoilageSearchText, spoilageRemovals]);

  useEffect(() => {
    const scaleAddress = store.getState().settings.scaleAddress;
    if (scaleAddress)
      RNBluetooth.connectToDevice(scaleAddress).catch(console.error);
  }, []);

  useEffect(() => {
    if (receivedData) {
      let numericValue = null;
      if (typeof receivedData === "string") {
        try {
          const decodedData = atob(receivedData);
          const match = decodedData.match(/-?\d+(\.\d+)?/);
          if (match) numericValue = parseFloat(match[0]);
        } catch {
          const match = receivedData.match(/-?\d+(\.\d+)?/);
          if (match) numericValue = parseFloat(match[0]);
        }
      } else if (typeof receivedData === "number") {
        numericValue = receivedData;
      }
      const newScaleData =
        numericValue !== null && !isNaN(numericValue)
          ? { reading: numericValue.toFixed(2) + "kg", isStable: true }
          : { reading: null, isStable: true };
      setScaleData(newScaleData);
      if (isWeighing && newScaleData.reading)
        setCurrentWeight(parseFloat(newScaleData.reading.replace("kg", "")));
    }
  }, [receivedData, isWeighing]);

  const loadSpoilageRemovals = async () => {
    try {
      const stored = await AsyncStorage.getItem(SPOILAGE_REMOVALS_KEY);
      if (stored) setSpoilageRemovals(JSON.parse(stored));
    } catch (error) {
      console.error("Failed to load spoilage removals", error);
    }
  };

  const loadCarcassBatches = async () => {
    try {
      const stored = await AsyncStorage.getItem(CARCASS_SESSIONS_KEY);
      if (stored) {
        const batches = JSON.parse(stored);
        const butcheryBatches =
          await AsyncStorage.getItem(BUTCHERY_BATCHES_KEY);
        const processedBatchIds = butcheryBatches
          ? JSON.parse(butcheryBatches).map((b) => b.originalBatchId)
          : [];
        const coldStockKey = getStockKeyForStore("cold");
        const coldStock = await AsyncStorage.getItem(coldStockKey);
        const currentStock = coldStock ? JSON.parse(coldStock) : [];
        const availableBatches = batches
          .filter((batch) => !processedBatchIds.includes(batch.id))
          .map((batch) => {
            const stockItem = currentStock.find(
              (item) => item.batchCode === batch.batchCode && !item.isDebonned,
            );
            return {
              ...batch,
              currentWeight: stockItem
                ? stockItem.totalWeight
                : batch.totalWeight,
              spoilageRemoved:
                batch.totalWeight -
                (stockItem ? stockItem.totalWeight : batch.totalWeight),
              removalReason: stockItem ? stockItem.removalReason : null,
            };
          });
        setCarcassBatches(availableBatches);
        setFilteredBatches(availableBatches);
      }
    } catch (error) {
      console.error("Failed to load carcass batches", error);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadCarcassBatches(), loadSpoilageRemovals()]);
    setRefreshing(false);
  };

  const startWeighing = (batch) => {
    setSelectedBatch(batch);
    setIsWeighing(true);
    setCurrentWeight(null);
    ToastAndroid.show(
      `Place ${batch.carcassType} on scale`,
      ToastAndroid.SHORT,
    );
  };

  const captureWeight = async () => {
    if (!currentWeight) {
      ToastAndroid.show("Please place item on scale", ToastAndroid.SHORT);
      return;
    }
    const newBatch = {
      id: Date.now().toString(),
      originalBatchId: selectedBatch.id,
      carcassType: selectedBatch.carcassType,
      batchCode: selectedBatch.batchCode,
      originalReceivedWeight:
        selectedBatch.originalReceivedWeight || selectedBatch.totalWeight,
      currentStockWeight: selectedBatch.currentWeight,
      weightBefore: currentWeight,
      weightAfter: null,
      variance: null,
      status: "pending",
      dateBefore: new Date().toLocaleString(),
      dateAfter: null,
      pieces: selectedBatch.totalPieces || 1,
      spoilageRemoved: selectedBatch.spoilageRemoved || 0,
    };
    try {
      const stored = await AsyncStorage.getItem(BUTCHERY_BATCHES_KEY);
      let batches = stored ? JSON.parse(stored) : [];
      batches.push(newBatch);
      await AsyncStorage.setItem(BUTCHERY_BATCHES_KEY, JSON.stringify(batches));
      syncToFirebase(
        "butcheryBatches",
        newBatch,
        store.getState().settings.BusinessId,
      );
      ToastAndroid.show(
        `Weight before captured: ${currentWeight.toFixed(3)} kg`,
        ToastAndroid.SHORT,
      );
      setIsWeighing(false);
      setSelectedBatch(null);
      setCurrentWeight(null);
      loadCarcassBatches();
      if (onBatchCreated) onBatchCreated();
    } catch (error) {
      console.error("Failed to save butchery batch", error);
      ToastAndroid.show("Error saving batch", ToastAndroid.SHORT);
    }
  };

  const renderBatchItem = ({ item }) => (
    <View style={styles.stockItem}>
      <View style={styles.stockDetails}>
        <Text style={styles.stockType}>{item.carcassType}</Text>
        <Text style={styles.stockInfo}>Batch No: {item.batchCode}</Text>
        <Text style={styles.stockInfo}>
          Received Weight:{" "}
          {item.totalWeight ? item.totalWeight.toFixed(3) : "0.000"} kg
        </Text>
        <Text style={styles.stockInfo}>
          Current Weight:{" "}
          {item.currentWeight ? item.currentWeight.toFixed(3) : "0.000"} kg
        </Text>
        {item.spoilageRemoved > 0 && (
          <Text style={[styles.stockInfo, { color: "#FF4444" }]}>
            Spoilage Removed: {item.spoilageRemoved.toFixed(3)} kg
          </Text>
        )}
        <Text style={styles.stockInfo}>{item.totalPieces} pieces</Text>
        <Text style={styles.stockDate}>Date: {item.date}</Text>
      </View>
      <TouchableOpacity
        style={[styles.removeButton, { backgroundColor: "#0066CC" }]}
        onPress={() => startWeighing(item)}
      >
        <Text style={styles.removeButtonText}>Weigh Before Debonning</Text>
      </TouchableOpacity>
    </View>
  );

  if (isWeighing) {
    return (
      <View style={styles.dryGoodsContainer}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => setIsWeighing(false)}
        >
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.dryGoodsTitle}>Weigh Before Debonning</Text>
        <Text style={styles.sessionType}>{selectedBatch?.carcassType}</Text>
        <Text style={styles.sessionInfo}>
          Batch No: {selectedBatch?.batchCode}
        </Text>
        <Text style={styles.sessionInfo}>
          Received Weight:{" "}
          {selectedBatch?.totalWeight
            ? selectedBatch.totalWeight.toFixed(3)
            : "0.000"}{" "}
          kg
        </Text>
        <Text style={styles.sessionInfo}>
          Current Weight:{" "}
          {selectedBatch?.currentWeight
            ? selectedBatch.currentWeight.toFixed(3)
            : "0.000"}{" "}
          kg
        </Text>
        {selectedBatch?.spoilageRemoved > 0 && (
          <Text style={[styles.sessionInfo, { color: "#FF4444" }]}>
            Spoilage Removed: {selectedBatch.spoilageRemoved.toFixed(3)} kg
          </Text>
        )}
        <View
          style={[
            styles.display,
            {
              backgroundColor: scaleData.isStable ? "green" : "red",
              marginTop: 20,
            },
          ]}
        >
          <View style={styles.data}>
            <Text style={styles.textBold}>Scale:</Text>
            <Text style={styles.textRegular}>
              {scaleData.reading ? "Connected" : "Disconnected"}
            </Text>
            <Text style={styles.textBold}>Stability:</Text>
            <Text style={styles.textRegular}>
              {scaleData.isStable ? "Stable" : "Unstable"}
            </Text>
          </View>
          <View>
            <Text style={styles.textWeight}>
              {scaleData.reading || "0.00 kg"}
            </Text>
          </View>
        </View>
        <TouchableOpacity
          style={[
            styles.captureButton,
            {
              backgroundColor: scaleData.isStable ? "#0066CC" : "#ccc",
              marginTop: 20,
            },
          ]}
          onPress={captureWeight}
          disabled={!scaleData.isStable}
        >
          <Text style={styles.captureButtonText}>
            Capture Weight Before Debonning
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: "#F9F9F9" }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      <View style={styles.dryGoodsContainer}>
        <TouchableOpacity style={styles.backButton} onPress={onClose}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.dryGoodsTitle}>Weight Before Debonning</Text>
        <TouchableOpacity style={styles.refreshButtonSmall} onPress={onRefresh}>
          <Text style={styles.refreshButtonSmallText}>↻ Refresh</Text>
        </TouchableOpacity>
        <Text style={styles.sectionHeader}>Available Carcass Batches</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Search by last 3 digits of batch no..."
          value={searchText}
          onChangeText={setSearchText}
        />
        <FlatList
          data={filteredBatches}
          keyExtractor={(item) => item.id}
          renderItem={renderBatchItem}
          ListEmptyComponent={
            <Text style={styles.emptyText}>No available carcass batches</Text>
          }
          scrollEnabled={false}
        />
        <Text style={styles.recordsHeader}>Spoilage Removal Records</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Search by last 3 digits of batch no..."
          value={spoilageSearchText}
          onChangeText={setSpoilageSearchText}
        />
        <FlatList
          data={filteredSpoilage}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View
              style={[styles.deletedRecordItem, { backgroundColor: "#FFF3E0" }]}
            >
              <View style={styles.deletedRecordDetails}>
                <Text style={styles.deletedRecordType}>
                  Carcass Type: {item.carcassType || "N/A"}
                </Text>
                <Text style={styles.deletedRecordInfo}>
                  Batch No: {item.batchCode}
                </Text>
                <Text style={styles.deletedRecordInfo}>
                  Received Weight: {item.receivedWeight.toFixed(3)} kg
                </Text>
                <Text style={styles.deletedRecordInfo}>
                  Current Weight: {item.currentWeight.toFixed(3)} kg
                </Text>
                <Text style={styles.deletedRecordInfo}>
                  Pieces: {item.pieces}
                </Text>
                <Text style={styles.deletedRecordInfo}>
                  Removed Weight: {item.weightRemoved.toFixed(3)} kg
                </Text>
                <Text style={styles.deletedRecordInfo}>
                  Reason: {item.reason}
                </Text>
                <Text style={styles.deletedRecordDate}>
                  Date & Time: {item.date}
                </Text>
              </View>
            </View>
          )}
          ListEmptyComponent={
            <Text style={styles.emptyText}>No spoilage removal records</Text>
          }
          scrollEnabled={false}
        />
      </View>
    </ScrollView>
  );
};

// ============ BUTCHERY WEIGHT AFTER SCREEN ============
const WeightAfterScreen = ({ onClose }) => {
  const [pendingBatches, setPendingBatches] = useState([]);
  const [filteredPending, setFilteredPending] = useState([]);
  const [pendingSearchText, setPendingSearchText] = useState("");
  const [completedBatches, setCompletedBatches] = useState([]);
  const [filteredCompleted, setFilteredCompleted] = useState([]);
  const [completedSearchText, setCompletedSearchText] = useState("");
  const [selectedBatch, setSelectedBatch] = useState(null);
  const [scaleData, setScaleData] = useState({
    reading: null,
    isStable: false,
  });
  const { receivedData } = useBluetooth();
  const [isWeighing, setIsWeighing] = useState(false);
  const [currentWeight, setCurrentWeight] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadPendingBatches();
  }, []);

  useEffect(() => {
    if (pendingSearchText.trim() === "") {
      setFilteredPending(pendingBatches);
    } else {
      const filtered = pendingBatches.filter(
        (item) =>
          item.batchCode &&
          item.batchCode
            .slice(-3)
            .toLowerCase()
            .includes(pendingSearchText.toLowerCase()),
      );
      setFilteredPending(filtered);
    }
  }, [pendingSearchText, pendingBatches]);

  useEffect(() => {
    if (completedSearchText.trim() === "") {
      setFilteredCompleted(completedBatches);
    } else {
      const filtered = completedBatches.filter(
        (item) =>
          item.batchCode &&
          item.batchCode
            .slice(-3)
            .toLowerCase()
            .includes(completedSearchText.toLowerCase()),
      );
      setFilteredCompleted(filtered);
    }
  }, [completedSearchText, completedBatches]);

  useEffect(() => {
    const scaleAddress = store.getState().settings.scaleAddress;
    if (scaleAddress)
      RNBluetooth.connectToDevice(scaleAddress).catch(console.error);
  }, []);

  useEffect(() => {
    if (receivedData) {
      let numericValue = null;
      if (typeof receivedData === "string") {
        try {
          const decodedData = atob(receivedData);
          const match = decodedData.match(/-?\d+(\.\d+)?/);
          if (match) numericValue = parseFloat(match[0]);
        } catch {
          const match = receivedData.match(/-?\d+(\.\d+)?/);
          if (match) numericValue = parseFloat(match[0]);
        }
      } else if (typeof receivedData === "number") {
        numericValue = receivedData;
      }
      const newScaleData =
        numericValue !== null && !isNaN(numericValue)
          ? { reading: numericValue.toFixed(2) + "kg", isStable: true }
          : { reading: null, isStable: true };
      setScaleData(newScaleData);
      if (isWeighing && newScaleData.reading)
        setCurrentWeight(parseFloat(newScaleData.reading.replace("kg", "")));
    }
  }, [receivedData, isWeighing]);

  const loadPendingBatches = async () => {
    try {
      const stored = await AsyncStorage.getItem(BUTCHERY_BATCHES_KEY);
      if (stored) {
        const batches = JSON.parse(stored);
        const pending = batches.filter((b) => b.status === "pending");
        const completed = batches
          .filter((b) => b.status === "completed")
          .reverse();
        setPendingBatches(pending);
        setFilteredPending(pending);
        setCompletedBatches(completed);
        setFilteredCompleted(completed);
      }
    } catch (error) {
      console.error("Failed to load pending batches", error);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadPendingBatches();
    setRefreshing(false);
  };

  const startWeighingAfter = (batch) => {
    setSelectedBatch(batch);
    setIsWeighing(true);
    setCurrentWeight(null);
    ToastAndroid.show(
      `Place deboned ${batch.carcassType} on scale`,
      ToastAndroid.SHORT,
    );
  };

  const captureWeightAfter = async () => {
    if (!currentWeight) {
      ToastAndroid.show("Please place item on scale", ToastAndroid.SHORT);
      return;
    }
    const variance = currentWeight - selectedBatch.weightBefore;
    const variancePercent = (
      (variance / selectedBatch.weightBefore) *
      100
    ).toFixed(2);
    try {
      const stored = await AsyncStorage.getItem(BUTCHERY_BATCHES_KEY);
      let batches = stored ? JSON.parse(stored) : [];
      const index = batches.findIndex((b) => b.id === selectedBatch.id);
      if (index !== -1) {
        batches[index].weightAfter = currentWeight;
        batches[index].variance = variance;
        batches[index].variancePercent = variancePercent;
        batches[index].status = "completed";
        batches[index].dateAfter = new Date().toLocaleString();
        await AsyncStorage.setItem(
          BUTCHERY_BATCHES_KEY,
          JSON.stringify(batches),
        );
        const businessId = store.getState().settings.BusinessId;
        syncToFirebase("butcheryBatches", batches[index], businessId);
        const coldStockKey = getStockKeyForStore("cold");
        const coldStock = await AsyncStorage.getItem(coldStockKey);
        let coldStockList = coldStock ? JSON.parse(coldStock) : [];
        const debonnedRecord = {
          id: Date.now().toString(),
          type: `${selectedBatch.carcassType} (Debonned)`,
          batchCode: selectedBatch.batchCode,
          originalReceivedWeight: selectedBatch.originalReceivedWeight,
          weightBeforeDebonning: selectedBatch.weightBefore,
          weightAfterDebonning: currentWeight,
          currentWeight: currentWeight,
          variance: variance,
          variancePercent: variancePercent,
          timestamp: new Date().toLocaleString(),
          lastUpdated: new Date().toISOString(),
          isDebonned: true,
          totalWeight: currentWeight,
          spoilageRemoved: selectedBatch.spoilageRemoved || 0,
        };
        coldStockList.unshift(debonnedRecord);
        await AsyncStorage.setItem(coldStockKey, JSON.stringify(coldStockList));
        syncToFirebase("debonnedRecords", debonnedRecord, businessId);
        const debonnedRecords =
          await AsyncStorage.getItem(DEBONNED_RECORDS_KEY);
        let allDebonnedRecords = debonnedRecords
          ? JSON.parse(debonnedRecords)
          : [];
        allDebonnedRecords.unshift(debonnedRecord);
        await AsyncStorage.setItem(
          DEBONNED_RECORDS_KEY,
          JSON.stringify(allDebonnedRecords),
        );
        ToastAndroid.show(
          `Weight after debonning: ${currentWeight.toFixed(3)} kg | Variance: ${variance > 0 ? "+" : ""}${variance.toFixed(3)} kg (${variancePercent}%)\nSaved to Coldroom`,
          ToastAndroid.LONG,
        );
        setIsWeighing(false);
        setSelectedBatch(null);
        setCurrentWeight(null);
        loadPendingBatches();
      }
    } catch (error) {
      console.error("Failed to save weight after", error);
      ToastAndroid.show("Error saving weight", ToastAndroid.SHORT);
    }
  };

  const renderPendingBatch = ({ item }) => (
    <View style={styles.stockItem}>
      <View style={styles.stockDetails}>
        <Text style={styles.stockType}>{item.carcassType}</Text>
        <Text style={styles.stockInfo}>Batch No: {item.batchCode}</Text>
        <Text style={styles.stockInfo}>
          Received Weight:{" "}
          {item.originalReceivedWeight
            ? item.originalReceivedWeight.toFixed(3)
            : "0.000"}{" "}
          kg
        </Text>
        <Text style={styles.stockInfo}>
          Current Stock Weight:{" "}
          {item.currentStockWeight
            ? item.currentStockWeight.toFixed(3)
            : "0.000"}{" "}
          kg
        </Text>
        <Text style={styles.stockInfo}>
          Weight Before Debonning: {item.weightBefore.toFixed(3)} kg
        </Text>
        {item.spoilageRemoved > 0 && (
          <Text style={[styles.stockInfo, { color: "#FF4444" }]}>
            Spoilage Removed: {item.spoilageRemoved.toFixed(3)} kg
          </Text>
        )}
        <Text style={styles.stockDate}>Date: {item.dateBefore}</Text>
      </View>
      <TouchableOpacity
        style={[styles.removeButton, { backgroundColor: "#FFA500" }]}
        onPress={() => startWeighingAfter(item)}
      >
        <Text style={styles.removeButtonText}>Weigh After Debonning</Text>
      </TouchableOpacity>
    </View>
  );

  const renderCompletedBatch = ({ item }) => {
    const varianceColor = item.variance >= 0 ? "#4CAF50" : "#FF4444";
    const varianceSign = item.variance >= 0 ? "+" : "";
    return (
      <View style={[styles.stockItem, { backgroundColor: "#F0FFF0" }]}>
        <View style={styles.stockDetails}>
          <Text style={styles.stockType}>{item.carcassType}</Text>
          <Text style={styles.stockInfo}>Batch No: {item.batchCode}</Text>
          <Text style={styles.stockInfo}>
            Received Weight:{" "}
            {item.originalReceivedWeight
              ? item.originalReceivedWeight.toFixed(3)
              : "0.000"}{" "}
            kg
          </Text>
          <Text style={styles.stockInfo}>
            Weight Before Debonning: {item.weightBefore.toFixed(3)} kg
          </Text>
          <Text style={styles.stockInfo}>
            Weight After Debonning: {item.weightAfter.toFixed(3)} kg
          </Text>
          <Text
            style={[
              styles.stockInfo,
              { color: varianceColor, fontWeight: "bold" },
            ]}
          >
            Variance: {varianceSign}
            {item.variance.toFixed(3)} kg ({item.variancePercent}%)
          </Text>
          {item.spoilageRemoved > 0 && (
            <Text style={[styles.stockInfo, { color: "#FF4444" }]}>
              Spoilage Removed: {item.spoilageRemoved.toFixed(3)} kg
            </Text>
          )}
          <Text style={styles.stockDate}>Timestamp: {item.dateAfter}</Text>
        </View>
      </View>
    );
  };

  if (isWeighing) {
    return (
      <View style={styles.dryGoodsContainer}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => setIsWeighing(false)}
        >
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.dryGoodsTitle}>Weigh After Debonning</Text>
        <Text style={styles.sessionType}>{selectedBatch?.carcassType}</Text>
        <Text style={styles.sessionInfo}>
          Batch No: {selectedBatch?.batchCode}
        </Text>
        <Text style={styles.sessionInfo}>
          Received Weight:{" "}
          {selectedBatch?.originalReceivedWeight
            ? selectedBatch.originalReceivedWeight.toFixed(3)
            : "0.000"}{" "}
          kg
        </Text>
        <Text style={styles.sessionInfo}>
          Weight Before Debonning: {selectedBatch?.weightBefore.toFixed(3)} kg
        </Text>
        {selectedBatch?.spoilageRemoved > 0 && (
          <Text style={[styles.sessionInfo, { color: "#FF4444" }]}>
            Spoilage Removed: {selectedBatch.spoilageRemoved.toFixed(3)} kg
          </Text>
        )}
        <View
          style={[
            styles.display,
            {
              backgroundColor: scaleData.isStable ? "green" : "red",
              marginTop: 20,
            },
          ]}
        >
          <View style={styles.data}>
            <Text style={styles.textBold}>Scale:</Text>
            <Text style={styles.textRegular}>
              {scaleData.reading ? "Connected" : "Disconnected"}
            </Text>
            <Text style={styles.textBold}>Stability:</Text>
            <Text style={styles.textRegular}>
              {scaleData.isStable ? "Stable" : "Unstable"}
            </Text>
          </View>
          <View>
            <Text style={styles.textWeight}>
              {scaleData.reading || "0.00 kg"}
            </Text>
          </View>
        </View>
        <TouchableOpacity
          style={[
            styles.captureButton,
            {
              backgroundColor: scaleData.isStable ? "#0066CC" : "#ccc",
              marginTop: 20,
            },
          ]}
          onPress={captureWeightAfter}
          disabled={!scaleData.isStable}
        >
          <Text style={styles.captureButtonText}>
            Capture Weight After Debonning & Save to Coldroom
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: "#F9F9F9" }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      <View style={styles.dryGoodsContainer}>
        <TouchableOpacity style={styles.backButton} onPress={onClose}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.dryGoodsTitle}>Weight After Debonning</Text>
        <TouchableOpacity style={styles.refreshButtonSmall} onPress={onRefresh}>
          <Text style={styles.refreshButtonSmallText}>↻ Refresh</Text>
        </TouchableOpacity>
        <Text style={styles.recordsHeader}>
          Pending Batches ({pendingBatches.length})
        </Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Search by last 3 digits of batch no..."
          value={pendingSearchText}
          onChangeText={setPendingSearchText}
        />
        <FlatList
          data={filteredPending}
          keyExtractor={(item) => item.id}
          renderItem={renderPendingBatch}
          ListEmptyComponent={
            <Text style={styles.emptyText}>No pending batches</Text>
          }
          scrollEnabled={false}
        />
        <Text style={styles.recordsHeader}>
          Completed Batches ({completedBatches.length})
        </Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Search by last 3 digits of batch no..."
          value={completedSearchText}
          onChangeText={setCompletedSearchText}
        />
        <FlatList
          data={filteredCompleted}
          keyExtractor={(item) => item.id}
          renderItem={renderCompletedBatch}
          ListEmptyComponent={
            <Text style={styles.emptyText}>No completed batches</Text>
          }
          scrollEnabled={false}
        />
        <View style={{ height: responsiveSize(20) }} />
      </View>
    </ScrollView>
  );
};

// ============ BUTCHERY MAIN SCREEN ============
const ButcheryScreen = ({ onClose }) => {
  const [showWeightBefore, setShowWeightBefore] = useState(false);
  const [showWeightAfter, setShowWeightAfter] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const handleBatchCreated = () => setRefreshKey((prev) => prev + 1);
  if (showWeightBefore)
    return (
      <WeightBeforeScreen
        onClose={() => setShowWeightBefore(false)}
        onBatchCreated={handleBatchCreated}
      />
    );
  if (showWeightAfter)
    return <WeightAfterScreen onClose={() => setShowWeightAfter(false)} />;
  return (
    <View style={styles.storageContainer}>
      <TouchableOpacity style={styles.backButton} onPress={onClose}>
        <Text style={styles.backButtonText}>← Back</Text>
      </TouchableOpacity>
      <Text style={styles.storageTitle}>Butchery Management</Text>
      <TouchableOpacity
        style={[styles.storageOption, { backgroundColor: "#0066CC" }]}
        onPress={() => setShowWeightBefore(true)}
      >
        <Text style={styles.storageOptionText}>Weight Before Debonning</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.storageOption, { backgroundColor: "#FFA500" }]}
        onPress={() => setShowWeightAfter(true)}
      >
        <Text style={styles.storageOptionText}>Weight After Debonning</Text>
      </TouchableOpacity>
    </View>
  );
};

// ============ GENERIC STORE SCREEN (with manual piece count edit) ============
const GenericStoreScreen = ({ onClose, storeInfo }) => {
  const [itemType, setItemType] = useState("");
  const [capturedRecords, setCapturedRecords] = useState([]);
  const [savedSessions, setSavedSessions] = useState([]);
  const [filteredSessions, setFilteredSessions] = useState([]);
  const [searchText, setSearchText] = useState("");
  const [deletedRecords, setDeletedRecords] = useState([]);
  const [filteredDeleted, setFilteredDeleted] = useState([]);
  const [deletedSearchText, setDeletedSearchText] = useState("");
  const [selectedStore, setSelectedStore] = useState(storeInfo.value);
  const [stores, setStores] = useState([]);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const SESSIONS_KEY_STORE = `@${storeInfo.value}_sessions`;
  const DELETIONS_KEY_STORE = `@${storeInfo.value}_deletions`;
  const { receivedData } = useBluetooth();
  const [scaleData, setScaleData] = useState({
    reading: null,
    isStable: false,
  });
  const [pieceCount, setPieceCount] = useState(0);
  const previousWeight = useRef(0);
  const isCountingEnabled = useRef(true);
  const MIN_PIECE_WEIGHT = 0.05;
  const isFirstCaptureAfterReset = useRef(true);
  const [isManualEditing, setIsManualEditing] = useState(false);

  useEffect(() => {
    const loadStores = async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_STORES_KEY);
        if (stored) setStores(JSON.parse(stored));
        else
          setStores([
            { label: "Dry Goods Store", value: "dry" },
            { label: "Coldroom", value: "cold" },
          ]);
      } catch (error) {
        console.error("Failed to load stores", error);
      }
    };
    loadStores();
  }, []);

  const loadSessions = async () => {
    try {
      const stored = await AsyncStorage.getItem(SESSIONS_KEY_STORE);
      if (stored) {
        let parsed = JSON.parse(stored);
        if (!Array.isArray(parsed)) parsed = [];
        parsed = parsed.map((session) => ({
          ...session,
          captures: Array.isArray(session.captures) ? session.captures : [],
          store: session.store || storeInfo.value,
        }));
        setSavedSessions(parsed);
        setFilteredSessions(parsed);
      } else {
        setSavedSessions([]);
        setFilteredSessions([]);
      }
    } catch (error) {
      console.error(`Failed to load ${storeInfo.label} sessions`, error);
      setSavedSessions([]);
      setFilteredSessions([]);
    }
  };

  const loadDeletions = async () => {
    try {
      const stored = await AsyncStorage.getItem(DELETIONS_KEY_STORE);
      if (stored) {
        const parsed = JSON.parse(stored);
        setDeletedRecords(Array.isArray(parsed) ? parsed : []);
        setFilteredDeleted(Array.isArray(parsed) ? parsed : []);
      } else {
        setDeletedRecords([]);
        setFilteredDeleted([]);
      }
    } catch (error) {
      console.error(`Failed to load ${storeInfo.label} deletions`, error);
      setDeletedRecords([]);
      setFilteredDeleted([]);
    }
  };

  useEffect(() => {
    loadSessions();
    loadDeletions();
  }, []);
  useEffect(() => {
    if (searchText.trim() === "") setFilteredSessions(savedSessions);
    else
      setFilteredSessions(
        savedSessions.filter(
          (item) =>
            item.type &&
            item.type
              .slice(-3)
              .toLowerCase()
              .includes(searchText.toLowerCase()),
        ),
      );
  }, [searchText, savedSessions]);
  useEffect(() => {
    if (deletedSearchText.trim() === "") setFilteredDeleted(deletedRecords);
    else
      setFilteredDeleted(
        deletedRecords.filter(
          (item) =>
            item.type &&
            item.type
              .slice(-3)
              .toLowerCase()
              .includes(deletedSearchText.toLowerCase()),
        ),
      );
  }, [deletedSearchText, deletedRecords]);
  useEffect(() => {
    const scaleAddress = store.getState().settings.scaleAddress;
    if (scaleAddress)
      RNBluetooth.connectToDevice(scaleAddress).catch(console.error);
  }, []);
  useEffect(() => {
    if (receivedData) {
      let numericValue = null;
      if (typeof receivedData === "string") {
        try {
          const decodedData = atob(receivedData);
          const match = decodedData.match(/-?\d+(\.\d+)?/);
          if (match) numericValue = parseFloat(match[0]);
        } catch {
          const match = receivedData.match(/-?\d+(\.\d+)?/);
          if (match) numericValue = parseFloat(match[0]);
        }
      } else if (typeof receivedData === "number") numericValue = receivedData;
      const newScaleData =
        numericValue !== null && !isNaN(numericValue)
          ? { reading: numericValue.toFixed(2) + "kg", isStable: true }
          : { reading: null, isStable: true };
      setScaleData(newScaleData);
    }
  }, [receivedData]);
  useEffect(() => {
    if (isManualEditing) return;
    if (
      scaleData.isStable &&
      scaleData.reading !== null &&
      isCountingEnabled.current
    ) {
      const currentWeight =
        parseFloat(scaleData.reading.replace("kg", "")) || 0;
      const weightChange = currentWeight - previousWeight.current;
      if (weightChange > MIN_PIECE_WEIGHT && currentWeight > MIN_PIECE_WEIGHT) {
        isCountingEnabled.current = false;
        setPieceCount((prev) => prev + 1);
        ToastAndroid.show(
          `✓ Added piece (${weightChange.toFixed(2)} kg)`,
          ToastAndroid.SHORT,
        );
        previousWeight.current = currentWeight;
        setTimeout(() => {
          isCountingEnabled.current = true;
        }, 2000);
      } else if (
        weightChange < -MIN_PIECE_WEIGHT &&
        pieceCount > 0 &&
        !isFirstCaptureAfterReset.current
      ) {
        isCountingEnabled.current = false;
        setPieceCount((prev) => prev - 1);
        ToastAndroid.show(
          `✓ Removed piece (${Math.abs(weightChange).toFixed(2)} kg)`,
          ToastAndroid.SHORT,
        );
        previousWeight.current = currentWeight;
        setTimeout(() => {
          isCountingEnabled.current = true;
        }, 2000);
      }
      if (Math.abs(weightChange) < 0.1) previousWeight.current = currentWeight;
    }
  }, [scaleData, pieceCount, isManualEditing]);
  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadSessions(), loadDeletions()]);
    setRefreshing(false);
  };
  const handleCapture = () => {
    if (!scaleData.reading || !scaleData.isStable) {
      ToastAndroid.show("Wait for stable reading", ToastAndroid.SHORT);
      return;
    }
    if (pieceCount === 0) {
      ToastAndroid.show("No pieces to capture", ToastAndroid.SHORT);
      return;
    }
    const currentWeight = parseFloat(scaleData.reading.replace("kg", "")) || 0;
    const newRecord = {
      id: Date.now().toString(),
      pieces: pieceCount,
      totalWeight: currentWeight,
      timestamp: new Date().toLocaleString(),
    };
    setCapturedRecords((prev) => [...prev, newRecord]);
    ToastAndroid.show(
      `Captured ${pieceCount} pcs, ${currentWeight.toFixed(2)} kg`,
      ToastAndroid.SHORT,
    );
    setPieceCount(0);
    previousWeight.current = 0;
    isCountingEnabled.current = true;
    isFirstCaptureAfterReset.current = true;
    setTimeout(() => {
      isFirstCaptureAfterReset.current = false;
    }, 500);
  };
  const deleteCapture = (id) => {
    setCapturedRecords((prev) => prev.filter((r) => r.id !== id));
    ToastAndroid.show("Capture deleted", ToastAndroid.SHORT);
  };
  const handleSave = async () => {
    if (!itemType.trim()) {
      ToastAndroid.show(
        `Please enter kind of ${storeInfo.label}`,
        ToastAndroid.SHORT,
      );
      return;
    }
    if (capturedRecords.length === 0) {
      ToastAndroid.show("No captures to save", ToastAndroid.SHORT);
      return;
    }
    const totalPieces = capturedRecords.reduce(
      (sum, cap) => sum + cap.pieces,
      0,
    );
    const totalWeightSum = capturedRecords.reduce(
      (sum, cap) => sum + cap.totalWeight,
      0,
    );
    const newSession = {
      id: Date.now().toString(),
      type: itemType.trim(),
      captures: capturedRecords,
      date: new Date().toLocaleString(),
      totalCaptures: capturedRecords.length,
      totalPieces: totalPieces,
      totalWeight: totalWeightSum,
      store: selectedStore,
    };
    const updatedSessions = [newSession, ...savedSessions];
    setSavedSessions(updatedSessions);
    try {
      await AsyncStorage.setItem(
        SESSIONS_KEY_STORE,
        JSON.stringify(updatedSessions),
      );
      syncToFirebase(
        "genericStoreSessions",
        newSession,
        store.getState().settings.BusinessId,
      );
      const stockKey = getStockKeyForStore(selectedStore);
      const stock = await AsyncStorage.getItem(stockKey);
      let stockList = stock ? JSON.parse(stock) : [];
      const existingIndex = stockList.findIndex(
        (item) => item.type === itemType.trim(),
      );
      if (existingIndex >= 0) {
        stockList[existingIndex].pieces += totalPieces;
        stockList[existingIndex].totalWeight += totalWeightSum;
        stockList[existingIndex].lastUpdated = new Date().toISOString();
      } else {
        stockList.push({
          id: Date.now().toString(),
          type: itemType.trim(),
          pieces: totalPieces,
          totalWeight: totalWeightSum,
          lastUpdated: new Date().toISOString(),
        });
      }
      await AsyncStorage.setItem(stockKey, JSON.stringify(stockList));
      ToastAndroid.show(
        `Session saved to ${storeInfo.label}`,
        ToastAndroid.SHORT,
      );
    } catch (error) {
      console.error("Failed to save session", error);
    }
    setItemType("");
    setCapturedRecords([]);
    setPieceCount(0);
    previousWeight.current = 0;
  };
  const requestDeleteSession = (session) => {
    setSessionToDelete(session);
    setDeleteReason("");
    setDeleteModalVisible(true);
  };
  const confirmDeleteSession = async () => {
    if (!deleteReason.trim()) {
      ToastAndroid.show(
        "Please provide a reason for deletion",
        ToastAndroid.SHORT,
      );
      return;
    }
    const session = sessionToDelete;
    if (!session) return;
    const updatedSessions = savedSessions.filter((s) => s.id !== session.id);
    setSavedSessions(updatedSessions);
    const deletionRecord = {
      id: Date.now().toString(),
      sessionId: session.id,
      type: session.type || "",
      store: session.store || "",
      totalPieces: session.totalPieces || 0,
      totalWeight: session.totalWeight || 0,
      captures: session.captures || [],
      originalDate: session.date || "",
      reason: deleteReason.trim(),
      deletedAt: new Date().toLocaleString(),
    };
    try {
      await AsyncStorage.setItem(
        SESSIONS_KEY_STORE,
        JSON.stringify(updatedSessions),
      );
      const storedDeletions = await AsyncStorage.getItem(DELETIONS_KEY_STORE);
      let allDeletions = storedDeletions ? JSON.parse(storedDeletions) : [];
      allDeletions = [deletionRecord, ...allDeletions];
      await AsyncStorage.setItem(
        DELETIONS_KEY_STORE,
        JSON.stringify(allDeletions),
      );
      setDeletedRecords(allDeletions);
      syncToFirebase(
        "deletedRecords",
        deletionRecord,
        store.getState().settings.BusinessId,
      );
      const stockKey = getStockKeyForStore(session.store);
      const stockRaw = await AsyncStorage.getItem(stockKey);
      let stockList = stockRaw ? JSON.parse(stockRaw) : [];
      const index = stockList.findIndex((item) => item.type === session.type);
      if (index !== -1) {
        const totalPiecesToRemove = session.totalPieces || 0;
        const totalWeightToRemove = session.totalWeight || 0;
        stockList[index].pieces -= totalPiecesToRemove;
        stockList[index].totalWeight -= totalWeightToRemove;
        if (stockList[index].pieces <= 0 || stockList[index].totalWeight <= 0)
          stockList.splice(index, 1);
        else stockList[index].lastUpdated = new Date().toISOString();
        await AsyncStorage.setItem(stockKey, JSON.stringify(stockList));
      }
      ToastAndroid.show("Session deleted and recorded", ToastAndroid.SHORT);
    } catch (error) {
      console.error(`Failed to delete ${storeInfo.label} session:`, error);
      ToastAndroid.show("Error deleting session", ToastAndroid.SHORT);
    }
    setDeleteModalVisible(false);
    setSessionToDelete(null);
    setDeleteReason("");
  };
  const renderCaptureItem = ({ item }) => (
    <View style={styles.captureItem}>
      <View style={styles.captureDetails}>
        <Text style={styles.captureText}>
          {item.pieces} pcs – {item.totalWeight.toFixed(2)} kg
        </Text>
        <Text style={styles.captureDate}>{item.timestamp}</Text>
      </View>
      <TouchableOpacity
        onPress={() => deleteCapture(item.id)}
        style={styles.deleteButton}
      >
        <Text style={styles.deleteButtonText}>X</Text>
      </TouchableOpacity>
    </View>
  );
  const renderSessionItem = ({ item }) => {
    const captures = item.captures || [];
    const storeLabel =
      stores.find((s) => s.value === item.store)?.label || item.store;
    return (
      <View style={styles.sessionItem}>
        <View style={styles.sessionDetails}>
          <Text style={styles.sessionType}>{item.type}</Text>
          <Text style={styles.sessionInfo}>
            {item.totalCaptures || captures.length} captures – {item.date}
          </Text>
          <Text style={styles.sessionStore}>Store: {storeLabel}</Text>
          {captures.slice(0, 2).map((cap, idx) => (
            <Text key={idx} style={styles.sessionCaptureSummary}>
              • {cap.pieces} pcs ({cap.totalWeight.toFixed(2)} kg)
            </Text>
          ))}
          {captures.length > 2 && (
            <Text style={styles.sessionCaptureSummary}>• ...</Text>
          )}
        </View>
        <TouchableOpacity
          onPress={() => requestDeleteSession(item)}
          style={styles.deleteButton}
        >
          <Text style={styles.deleteButtonText}>Delete</Text>
        </TouchableOpacity>
      </View>
    );
  };
  const renderDeletedRecord = ({ item }) => {
    const storeLabel =
      stores.find((s) => s.value === item.store)?.label || item.store || "—";
    return (
      <View style={styles.deletedRecordItem}>
        <View style={styles.deletedRecordDetails}>
          <Text style={styles.deletedRecordType}>{item.type}</Text>
          <Text style={styles.deletedRecordInfo}>
            {item.totalPieces || 0} pieces |{" "}
            {(item.totalWeight || 0).toFixed(2)} kg
          </Text>
          <Text style={styles.deletedRecordInfo}>Store: {storeLabel}</Text>
          <Text style={styles.deletedRecordReason}>Reason: {item.reason}</Text>
          <Text style={styles.deletedRecordDate}>
            Deleted: {item.deletedAt}
          </Text>
          <Text style={styles.deletedRecordDate}>
            Original date: {item.originalDate}
          </Text>
        </View>
      </View>
    );
  };
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: "#F9F9F9" }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      <View style={styles.dryGoodsContainer}>
        <TouchableOpacity style={styles.backButton} onPress={onClose}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.dryGoodsTitle}>{storeInfo.label}</Text>
        <TouchableOpacity style={styles.refreshButtonSmall} onPress={onRefresh}>
          <Text style={styles.refreshButtonSmallText}>↻ Refresh</Text>
        </TouchableOpacity>
        <View style={styles.formContainer}>
          <TextInput
            style={styles.inputField}
            placeholder={`Kind of ${storeInfo.label}`}
            value={itemType}
            onChangeText={setItemType}
          />
          <View
            style={[
              styles.display,
              { backgroundColor: scaleData.isStable ? "green" : "red" },
            ]}
          >
            <View style={styles.data}>
              <Text style={styles.textBold}>Scale:</Text>
              <Text style={styles.textRegular}>
                {scaleData.reading ? "Connected" : "Disconnected"}
              </Text>
              <Text style={styles.textBold}>Stability:</Text>
              <Text style={styles.textRegular}>
                {scaleData.isStable ? "Stable" : "Unstable"}
              </Text>
            </View>
            <View>
              <Text style={styles.textWeight}>
                {scaleData.reading || "0.00 kg"}
              </Text>
            </View>
          </View>
          <View style={styles.summaryRow}>
            <View style={styles.summaryBox}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <Text style={styles.summaryText}>Current pieces: </Text>
                <TextInput
                  style={[
                    styles.summaryText,
                    {
                      width: 80,
                      borderBottomWidth: 1,
                      borderColor: "#CCC",
                      textAlign: "center",
                    },
                  ]}
                  keyboardType="numeric"
                  value={pieceCount.toString()}
                  onFocus={() => setIsManualEditing(true)}
                  onBlur={() =>
                    setTimeout(() => setIsManualEditing(false), 2000)
                  }
                  onChangeText={(text) => {
                    const num = text === "" ? 0 : parseInt(text);
                    if (!isNaN(num)) setPieceCount(num);
                  }}
                />
              </View>
            </View>
            <TouchableOpacity
              style={styles.resetButton}
              onPress={() => {
                setPieceCount(0);
                previousWeight.current = 0;
                isCountingEnabled.current = true;
                isFirstCaptureAfterReset.current = true;
                ToastAndroid.show("Counters reset", ToastAndroid.SHORT);
                setTimeout(() => {
                  isFirstCaptureAfterReset.current = false;
                }, 500);
              }}
            >
              <Text style={styles.resetButtonText}>Reset</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={[
              styles.captureButton,
              { backgroundColor: scaleData.isStable ? "#0066CC" : "#ccc" },
            ]}
            onPress={handleCapture}
            disabled={!scaleData.isStable}
          >
            <Text style={styles.captureButtonText}>Capture</Text>
          </TouchableOpacity>
          <Text style={styles.sectionHeader}>
            Captures ({capturedRecords.length})
          </Text>
          <FlatList
            data={capturedRecords}
            keyExtractor={(item) => item.id}
            renderItem={renderCaptureItem}
            ListEmptyComponent={
              <Text style={styles.emptyText}>No captures yet</Text>
            }
            scrollEnabled={false}
          />
          <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
            <Text style={styles.saveButtonText}>Save Session</Text>
          </TouchableOpacity>
          <Text style={styles.recordsHeader}>
            Previous {storeInfo.label} Sessions
          </Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search by last 3 digits of item type..."
            value={searchText}
            onChangeText={setSearchText}
          />
          <FlatList
            data={filteredSessions}
            keyExtractor={(item) => item.id}
            renderItem={renderSessionItem}
            ListEmptyComponent={
              <Text style={styles.emptyText}>No sessions yet</Text>
            }
            scrollEnabled={false}
          />
          <Text style={styles.recordsHeader}>
            Deleted {storeInfo.label} Records ({deletedRecords.length})
          </Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search by last 3 digits of item type..."
            value={deletedSearchText}
            onChangeText={setDeletedSearchText}
          />
          <FlatList
            data={filteredDeleted}
            keyExtractor={(item) => item.id}
            renderItem={renderDeletedRecord}
            ListEmptyComponent={
              <Text style={styles.emptyText}>No deleted records yet</Text>
            }
            scrollEnabled={false}
          />
          <View style={{ height: responsiveSize(20) }} />
        </View>
      </View>
      <Modal
        animationType="slide"
        transparent
        visible={deleteModalVisible}
        onRequestClose={() => setDeleteModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Delete Session</Text>
            {sessionToDelete && (
              <>
                <Text style={styles.modalSubtitle}>
                  Type: {sessionToDelete.type}
                </Text>
                <Text style={styles.modalSubtitle}>
                  {sessionToDelete.totalPieces || 0} pieces |{" "}
                  {(sessionToDelete.totalWeight || 0).toFixed(2)} kg
                </Text>
                <Text style={styles.modalSubtitle}>
                  Store:{" "}
                  {stores.find((s) => s.value === sessionToDelete.store)
                    ?.label || sessionToDelete.store}
                </Text>
              </>
            )}
            <Text
              style={[
                styles.modalSubtitle,
                { marginTop: 12, color: "#CC0000" },
              ]}
            >
              A reason is required before deleting this record.
            </Text>
            <TextInput
              style={[styles.inputField, { marginTop: 10 }]}
              placeholder="Reason for deletion (required)"
              value={deleteReason}
              onChangeText={setDeleteReason}
              multiline
              numberOfLines={3}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: "#FF4444" }]}
                onPress={confirmDeleteSession}
              >
                <Text style={styles.modalButtonText}>Delete</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: "#888" }]}
                onPress={() => {
                  setDeleteModalVisible(false);
                  setSessionToDelete(null);
                  setDeleteReason("");
                }}
              >
                <Text style={styles.modalButtonText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
};

// ============ DRY GOODS SCREEN (with manual piece count edit) ============
const DryGoodsScreen = ({ onClose }) => {
  const [dryGoodsType, setDryGoodsType] = useState("");
  const [capturedRecords, setCapturedRecords] = useState([]);
  const [savedSessions, setSavedSessions] = useState([]);
  const [filteredSessions, setFilteredSessions] = useState([]);
  const [searchText, setSearchText] = useState("");
  const [deletedRecords, setDeletedRecords] = useState([]);
  const [filteredDeleted, setFilteredDeleted] = useState([]);
  const [deletedSearchText, setDeletedSearchText] = useState("");
  const [selectedStore, setSelectedStore] = useState("dry");
  const [stores, setStores] = useState([]);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const { receivedData } = useBluetooth();
  const [scaleData, setScaleData] = useState({
    reading: null,
    isStable: false,
  });
  const [pieceCount, setPieceCount] = useState(0);
  const previousWeight = useRef(0);
  const isCountingEnabled = useRef(true);
  const MIN_PIECE_WEIGHT = 0.05;
  const isFirstCaptureAfterReset = useRef(true);
  const [isManualEditing, setIsManualEditing] = useState(false);

  useEffect(() => {
    const loadStores = async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_STORES_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          setStores(parsed);
          if (
            !parsed.some((s) => s.value === selectedStore) &&
            parsed.length > 0
          )
            setSelectedStore(parsed[0].value);
        } else {
          const defaultStores = [
            { label: "Dry Goods Store", value: "dry" },
            { label: "Coldroom", value: "cold" },
          ];
          setStores(defaultStores);
          await AsyncStorage.setItem(
            STORAGE_STORES_KEY,
            JSON.stringify(defaultStores),
          );
        }
      } catch (error) {
        console.error("Failed to load stores", error);
      }
    };
    loadStores();
  }, []);
  const storeOptions = stores.map((s) => ({ label: s.label, value: s.value }));
  const loadSessions = async () => {
    try {
      const stored = await AsyncStorage.getItem(SESSIONS_KEY);
      if (stored) {
        let parsed = JSON.parse(stored);
        if (!Array.isArray(parsed)) parsed = [];
        parsed = parsed.map((session) => ({
          ...session,
          captures: Array.isArray(session.captures) ? session.captures : [],
          store: session.store || "dry",
        }));
        setSavedSessions(parsed);
        setFilteredSessions(parsed);
      } else {
        setSavedSessions([]);
        setFilteredSessions([]);
      }
    } catch (error) {
      console.error("Failed to load dry goods sessions", error);
      setSavedSessions([]);
      setFilteredSessions([]);
    }
  };
  const loadDeletions = async () => {
    try {
      const stored = await AsyncStorage.getItem(DRY_GOODS_DELETIONS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        setDeletedRecords(Array.isArray(parsed) ? parsed : []);
        setFilteredDeleted(Array.isArray(parsed) ? parsed : []);
      } else {
        setDeletedRecords([]);
        setFilteredDeleted([]);
      }
    } catch (error) {
      console.error("Failed to load dry goods deletions", error);
      setDeletedRecords([]);
      setFilteredDeleted([]);
    }
  };
  useEffect(() => {
    loadSessions();
    loadDeletions();
  }, []);
  useEffect(() => {
    if (searchText.trim() === "") setFilteredSessions(savedSessions);
    else
      setFilteredSessions(
        savedSessions.filter(
          (item) =>
            item.type &&
            item.type
              .slice(-3)
              .toLowerCase()
              .includes(searchText.toLowerCase()),
        ),
      );
  }, [searchText, savedSessions]);
  useEffect(() => {
    if (deletedSearchText.trim() === "") setFilteredDeleted(deletedRecords);
    else
      setFilteredDeleted(
        deletedRecords.filter(
          (item) =>
            item.type &&
            item.type
              .slice(-3)
              .toLowerCase()
              .includes(deletedSearchText.toLowerCase()),
        ),
      );
  }, [deletedSearchText, deletedRecords]);
  useEffect(() => {
    const scaleAddress = store.getState().settings.scaleAddress;
    if (scaleAddress)
      RNBluetooth.connectToDevice(scaleAddress).catch(console.error);
  }, []);
  useEffect(() => {
    if (receivedData) {
      let numericValue = null;
      if (typeof receivedData === "string") {
        try {
          const decodedData = atob(receivedData);
          const match = decodedData.match(/-?\d+(\.\d+)?/);
          if (match) numericValue = parseFloat(match[0]);
        } catch {
          const match = receivedData.match(/-?\d+(\.\d+)?/);
          if (match) numericValue = parseFloat(match[0]);
        }
      } else if (typeof receivedData === "number") numericValue = receivedData;
      const newScaleData =
        numericValue !== null && !isNaN(numericValue)
          ? { reading: numericValue.toFixed(2) + "kg", isStable: true }
          : { reading: null, isStable: true };
      setScaleData(newScaleData);
    }
  }, [receivedData]);
  useEffect(() => {
    if (isManualEditing) return;
    if (
      scaleData.isStable &&
      scaleData.reading !== null &&
      isCountingEnabled.current
    ) {
      const currentWeight =
        parseFloat(scaleData.reading.replace("kg", "")) || 0;
      const weightChange = currentWeight - previousWeight.current;
      if (weightChange > MIN_PIECE_WEIGHT && currentWeight > MIN_PIECE_WEIGHT) {
        isCountingEnabled.current = false;
        setPieceCount((prev) => prev + 1);
        ToastAndroid.show(
          `✓ Added piece (${weightChange.toFixed(2)} kg)`,
          ToastAndroid.SHORT,
        );
        previousWeight.current = currentWeight;
        setTimeout(() => {
          isCountingEnabled.current = true;
        }, 2000);
      } else if (
        weightChange < -MIN_PIECE_WEIGHT &&
        pieceCount > 0 &&
        !isFirstCaptureAfterReset.current
      ) {
        isCountingEnabled.current = false;
        setPieceCount((prev) => prev - 1);
        ToastAndroid.show(
          `✓ Removed piece (${Math.abs(weightChange).toFixed(2)} kg)`,
          ToastAndroid.SHORT,
        );
        previousWeight.current = currentWeight;
        setTimeout(() => {
          isCountingEnabled.current = true;
        }, 2000);
      }
      if (Math.abs(weightChange) < 0.1) previousWeight.current = currentWeight;
    }
  }, [scaleData, pieceCount, isManualEditing]);
  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadSessions(), loadDeletions()]);
    setRefreshing(false);
  };
  const handleCapture = () => {
    if (!scaleData.reading || !scaleData.isStable) {
      ToastAndroid.show("Wait for stable reading", ToastAndroid.SHORT);
      return;
    }
    if (pieceCount === 0) {
      ToastAndroid.show("No pieces to capture", ToastAndroid.SHORT);
      return;
    }
    const currentWeight = parseFloat(scaleData.reading.replace("kg", "")) || 0;
    const newRecord = {
      id: Date.now().toString(),
      pieces: pieceCount,
      totalWeight: currentWeight,
      timestamp: new Date().toLocaleString(),
    };
    setCapturedRecords((prev) => [...prev, newRecord]);
    ToastAndroid.show(
      `Captured ${pieceCount} pcs, ${currentWeight.toFixed(2)} kg`,
      ToastAndroid.SHORT,
    );
    setPieceCount(0);
    previousWeight.current = 0;
    isCountingEnabled.current = true;
    isFirstCaptureAfterReset.current = true;
    setTimeout(() => {
      isFirstCaptureAfterReset.current = false;
    }, 500);
  };
  const deleteCapture = (id) => {
    setCapturedRecords((prev) => prev.filter((r) => r.id !== id));
    ToastAndroid.show("Capture deleted", ToastAndroid.SHORT);
  };
  const handleSave = async () => {
    if (!dryGoodsType.trim()) {
      ToastAndroid.show("Please enter kind of dry goods", ToastAndroid.SHORT);
      return;
    }
    if (capturedRecords.length === 0) {
      ToastAndroid.show("No captures to save", ToastAndroid.SHORT);
      return;
    }
    const totalPieces = capturedRecords.reduce(
      (sum, cap) => sum + cap.pieces,
      0,
    );
    const totalWeightSum = capturedRecords.reduce(
      (sum, cap) => sum + cap.totalWeight,
      0,
    );
    const newSession = {
      id: Date.now().toString(),
      type: dryGoodsType.trim(),
      captures: capturedRecords,
      date: new Date().toLocaleString(),
      totalCaptures: capturedRecords.length,
      totalPieces: totalPieces,
      totalWeight: totalWeightSum,
      store: selectedStore,
    };
    const updatedSessions = [newSession, ...savedSessions];
    setSavedSessions(updatedSessions);
    try {
      await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify(updatedSessions));
      syncToFirebase(
        "dryGoodsSessions",
        newSession,
        store.getState().settings.BusinessId,
      );
      const stockKey = getStockKeyForStore(selectedStore);
      const stock = await AsyncStorage.getItem(stockKey);
      let stockList = stock ? JSON.parse(stock) : [];
      const existingIndex = stockList.findIndex(
        (item) => item.type === dryGoodsType.trim(),
      );
      if (existingIndex >= 0) {
        stockList[existingIndex].pieces += totalPieces;
        stockList[existingIndex].totalWeight += totalWeightSum;
        stockList[existingIndex].lastUpdated = new Date().toISOString();
      } else {
        stockList.push({
          id: Date.now().toString(),
          type: dryGoodsType.trim(),
          pieces: totalPieces,
          totalWeight: totalWeightSum,
          lastUpdated: new Date().toISOString(),
        });
      }
      await AsyncStorage.setItem(stockKey, JSON.stringify(stockList));
      const storeLabel =
        stores.find((s) => s.value === selectedStore)?.label || selectedStore;
      ToastAndroid.show(`Session saved to ${storeLabel}`, ToastAndroid.SHORT);
    } catch (error) {
      console.error("Failed to save session", error);
    }
    setDryGoodsType("");
    setCapturedRecords([]);
    setPieceCount(0);
    previousWeight.current = 0;
  };
  const requestDeleteSession = (session) => {
    setSessionToDelete(session);
    setDeleteReason("");
    setDeleteModalVisible(true);
  };
  const confirmDeleteSession = async () => {
    if (!deleteReason.trim()) {
      ToastAndroid.show(
        "Please provide a reason for deletion",
        ToastAndroid.SHORT,
      );
      return;
    }
    const session = sessionToDelete;
    if (!session) return;
    const updatedSessions = savedSessions.filter((s) => s.id !== session.id);
    setSavedSessions(updatedSessions);
    const deletionRecord = {
      id: Date.now().toString(),
      sessionId: session.id,
      type: session.type || "",
      store: session.store || "",
      totalPieces: session.totalPieces || 0,
      totalWeight: session.totalWeight || 0,
      captures: session.captures || [],
      originalDate: session.date || "",
      reason: deleteReason.trim(),
      deletedAt: new Date().toLocaleString(),
    };
    try {
      await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify(updatedSessions));
      const storedDeletions = await AsyncStorage.getItem(
        DRY_GOODS_DELETIONS_KEY,
      );
      let allDeletions = storedDeletions ? JSON.parse(storedDeletions) : [];
      allDeletions = [deletionRecord, ...allDeletions];
      await AsyncStorage.setItem(
        DRY_GOODS_DELETIONS_KEY,
        JSON.stringify(allDeletions),
      );
      setDeletedRecords(allDeletions);
      syncToFirebase(
        "deletedRecords",
        deletionRecord,
        store.getState().settings.BusinessId,
      );
      const stockKey = getStockKeyForStore(session.store);
      const stockRaw = await AsyncStorage.getItem(stockKey);
      let stockList = stockRaw ? JSON.parse(stockRaw) : [];
      const index = stockList.findIndex((item) => item.type === session.type);
      if (index !== -1) {
        const totalPiecesToRemove = session.totalPieces || 0;
        const totalWeightToRemove = session.totalWeight || 0;
        stockList[index].pieces -= totalPiecesToRemove;
        stockList[index].totalWeight -= totalWeightToRemove;
        if (stockList[index].pieces <= 0 || stockList[index].totalWeight <= 0)
          stockList.splice(index, 1);
        else stockList[index].lastUpdated = new Date().toISOString();
        await AsyncStorage.setItem(stockKey, JSON.stringify(stockList));
      }
      ToastAndroid.show("Session deleted and recorded", ToastAndroid.SHORT);
    } catch (error) {
      console.error("Failed to delete dry goods session:", error);
      ToastAndroid.show("Error deleting session", ToastAndroid.SHORT);
    }
    setDeleteModalVisible(false);
    setSessionToDelete(null);
    setDeleteReason("");
  };
  const renderCaptureItem = ({ item }) => (
    <View style={styles.captureItem}>
      <View style={styles.captureDetails}>
        <Text style={styles.captureText}>
          {item.pieces} pcs – {item.totalWeight.toFixed(2)} kg
        </Text>
        <Text style={styles.captureDate}>{item.timestamp}</Text>
      </View>
      <TouchableOpacity
        onPress={() => deleteCapture(item.id)}
        style={styles.deleteButton}
      >
        <Text style={styles.deleteButtonText}>X</Text>
      </TouchableOpacity>
    </View>
  );
  const renderSessionItem = ({ item }) => {
    const captures = item.captures || [];
    const storeLabel =
      stores.find((s) => s.value === item.store)?.label || item.store;
    return (
      <View style={styles.sessionItem}>
        <View style={styles.sessionDetails}>
          <Text style={styles.sessionType}>{item.type}</Text>
          <Text style={styles.sessionInfo}>
            {item.totalCaptures || captures.length} captures – {item.date}
          </Text>
          <Text style={styles.sessionStore}>Store: {storeLabel}</Text>
          {captures.slice(0, 2).map((cap, idx) => (
            <Text key={idx} style={styles.sessionCaptureSummary}>
              • {cap.pieces} pcs ({cap.totalWeight.toFixed(2)} kg)
            </Text>
          ))}
          {captures.length > 2 && (
            <Text style={styles.sessionCaptureSummary}>• ...</Text>
          )}
        </View>
        <TouchableOpacity
          onPress={() => requestDeleteSession(item)}
          style={styles.deleteButton}
        >
          <Text style={styles.deleteButtonText}>Delete</Text>
        </TouchableOpacity>
      </View>
    );
  };
  const renderDeletedRecord = ({ item }) => {
    const storeLabel =
      stores.find((s) => s.value === item.store)?.label || item.store || "—";
    return (
      <View style={styles.deletedRecordItem}>
        <View style={styles.deletedRecordDetails}>
          <Text style={styles.deletedRecordType}>{item.type}</Text>
          <Text style={styles.deletedRecordInfo}>
            {item.totalPieces || 0} pieces |{" "}
            {(item.totalWeight || 0).toFixed(2)} kg
          </Text>
          <Text style={styles.deletedRecordInfo}>Store: {storeLabel}</Text>
          <Text style={styles.deletedRecordReason}>Reason: {item.reason}</Text>
          <Text style={styles.deletedRecordDate}>
            Deleted: {item.deletedAt}
          </Text>
          <Text style={styles.deletedRecordDate}>
            Original date: {item.originalDate}
          </Text>
        </View>
      </View>
    );
  };
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: "#F9F9F9" }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      <View style={styles.dryGoodsContainer}>
        <TouchableOpacity style={styles.backButton} onPress={onClose}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <View style={styles.formContainer}>
          <DropdownComponent
            title="Store"
            onChange={(item) => setSelectedStore(item.value)}
            data={storeOptions}
            value={storeOptions.find((opt) => opt.value === selectedStore)}
            placeholder="Select Store"
          />
          <TextInput
            style={styles.inputField}
            placeholder="Kind of Dry Goods"
            value={dryGoodsType}
            onChangeText={setDryGoodsType}
          />
          <View
            style={[
              styles.display,
              { backgroundColor: scaleData.isStable ? "green" : "red" },
            ]}
          >
            <View style={styles.data}>
              <Text style={styles.textBold}>Scale:</Text>
              <Text style={styles.textRegular}>
                {scaleData.reading ? "Connected" : "Disconnected"}
              </Text>
              <Text style={styles.textBold}>Stability:</Text>
              <Text style={styles.textRegular}>
                {scaleData.isStable ? "Stable" : "Unstable"}
              </Text>
            </View>
            <View>
              <Text style={styles.textWeight}>
                {scaleData.reading || "0.00 kg"}
              </Text>
            </View>
          </View>
          <View style={styles.summaryRow}>
            <View style={styles.summaryBox}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <Text style={styles.summaryText}>Current pieces: </Text>
                <TextInput
                  style={[
                    styles.summaryText,
                    {
                      width: 80,
                      borderBottomWidth: 1,
                      borderColor: "#CCC",
                      textAlign: "center",
                    },
                  ]}
                  keyboardType="numeric"
                  value={pieceCount.toString()}
                  onFocus={() => setIsManualEditing(true)}
                  onBlur={() =>
                    setTimeout(() => setIsManualEditing(false), 2000)
                  }
                  onChangeText={(text) => {
                    const num = text === "" ? 0 : parseInt(text);
                    if (!isNaN(num)) setPieceCount(num);
                  }}
                />
              </View>
            </View>
            <TouchableOpacity
              style={styles.resetButton}
              onPress={() => {
                setPieceCount(0);
                previousWeight.current = 0;
                isCountingEnabled.current = true;
                isFirstCaptureAfterReset.current = true;
                ToastAndroid.show("Counters reset", ToastAndroid.SHORT);
                setTimeout(() => {
                  isFirstCaptureAfterReset.current = false;
                }, 500);
              }}
            >
              <Text style={styles.resetButtonText}>Reset</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={[
              styles.captureButton,
              { backgroundColor: scaleData.isStable ? "#0066CC" : "#ccc" },
            ]}
            onPress={handleCapture}
            disabled={!scaleData.isStable}
          >
            <Text style={styles.captureButtonText}>Capture</Text>
          </TouchableOpacity>
          <Text style={styles.sectionHeader}>
            Captures ({capturedRecords.length})
          </Text>
          <FlatList
            data={capturedRecords}
            keyExtractor={(item) => item.id}
            renderItem={renderCaptureItem}
            ListEmptyComponent={
              <Text style={styles.emptyText}>No captures yet</Text>
            }
            scrollEnabled={false}
          />
          <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
            <Text style={styles.saveButtonText}>Save Session</Text>
          </TouchableOpacity>
          <Text style={styles.recordsHeader}>Previous Dry Goods Sessions</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search by last 3 digits of dry goods type..."
            value={searchText}
            onChangeText={setSearchText}
          />
          <FlatList
            data={filteredSessions}
            keyExtractor={(item) => item.id}
            renderItem={renderSessionItem}
            ListEmptyComponent={
              <Text style={styles.emptyText}>No sessions yet</Text>
            }
            scrollEnabled={false}
          />
          <Text style={styles.recordsHeader}>
            Deleted Dry Goods Records ({deletedRecords.length})
          </Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search by last 3 digits of dry goods type..."
            value={deletedSearchText}
            onChangeText={setDeletedSearchText}
          />
          <FlatList
            data={filteredDeleted}
            keyExtractor={(item) => item.id}
            renderItem={renderDeletedRecord}
            ListEmptyComponent={
              <Text style={styles.emptyText}>No deleted records yet</Text>
            }
            scrollEnabled={false}
          />
          <View style={{ height: responsiveSize(20) }} />
        </View>
      </View>
      <Modal
        animationType="slide"
        transparent
        visible={deleteModalVisible}
        onRequestClose={() => setDeleteModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Delete Session</Text>
            {sessionToDelete && (
              <>
                <Text style={styles.modalSubtitle}>
                  Type: {sessionToDelete.type}
                </Text>
                <Text style={styles.modalSubtitle}>
                  {sessionToDelete.totalPieces || 0} pieces |{" "}
                  {(sessionToDelete.totalWeight || 0).toFixed(2)} kg
                </Text>
                <Text style={styles.modalSubtitle}>
                  Store:{" "}
                  {stores.find((s) => s.value === sessionToDelete.store)
                    ?.label || sessionToDelete.store}
                </Text>
              </>
            )}
            <Text
              style={[
                styles.modalSubtitle,
                { marginTop: 12, color: "#CC0000" },
              ]}
            >
              A reason is required before deleting this record.
            </Text>
            <TextInput
              style={[styles.inputField, { marginTop: 10 }]}
              placeholder="Reason for deletion (required)"
              value={deleteReason}
              onChangeText={setDeleteReason}
              multiline
              numberOfLines={3}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: "#FF4444" }]}
                onPress={confirmDeleteSession}
              >
                <Text style={styles.modalButtonText}>Delete</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: "#888" }]}
                onPress={() => {
                  setDeleteModalVisible(false);
                  setSessionToDelete(null);
                  setDeleteReason("");
                }}
              >
                <Text style={styles.modalButtonText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
};

// ============ STORAGE SCREEN ============
const StorageScreen = ({ onClose, onStoreCreated }) => {
  const [selectedStore, setSelectedStore] = useState(null);
  const [stock, setStock] = useState([]);
  const [filteredStock, setFilteredStock] = useState([]);
  const [stockSearchText, setStockSearchText] = useState("");
  const [removals, setRemovals] = useState([]);
  const [filteredRemovals, setFilteredRemovals] = useState([]);
  const [removalsSearchText, setRemovalsSearchText] = useState("");
  const [debonnedStock, setDebonnedStock] = useState([]);
  const [filteredDebonned, setFilteredDebonned] = useState([]);
  const [debonnedSearchText, setDebonnedSearchText] = useState("");
  const [removalModalVisible, setRemovalModalVisible] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [removeWeight, setRemoveWeight] = useState("");
  const [removalReason, setRemovalReason] = useState("");
  const [stores, setStores] = useState([]);
  const [manageStoresVisible, setManageStoresVisible] = useState(false);
  const [newStoreName, setNewStoreName] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const loadStores = async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_STORES_KEY);
        if (stored) setStores(JSON.parse(stored));
        else {
          const defaultStores = [
            { label: "Dry Goods Store", value: "dry" },
            { label: "Coldroom", value: "cold" },
          ];
          setStores(defaultStores);
          await AsyncStorage.setItem(
            STORAGE_STORES_KEY,
            JSON.stringify(defaultStores),
          );
        }
      } catch (error) {
        console.error("Failed to load stores", error);
      }
    };
    loadStores();
  }, []);
  useEffect(() => {
    if (stores.length > 0) {
      AsyncStorage.setItem(STORAGE_STORES_KEY, JSON.stringify(stores)).catch(
        console.error,
      );
      if (onStoreCreated) onStoreCreated(stores);
    }
  }, [stores, onStoreCreated]);
  const loadStock = async (storeValue) => {
    try {
      const stockKey = getStockKeyForStore(storeValue);
      const stored = await AsyncStorage.getItem(stockKey);
      const allStock = stored ? JSON.parse(stored) : [];
      const regularStock = allStock.filter((item) => !item.isDebonned);
      const debonnedItems = allStock.filter((item) => item.isDebonned === true);
      const sortedDebonned = debonnedItems.sort(
        (a, b) => new Date(b.timestamp) - new Date(a.timestamp),
      );
      const sortedRegular = regularStock.sort(
        (a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated),
      );
      setStock(sortedRegular);
      setFilteredStock(sortedRegular);
      setDebonnedStock(sortedDebonned);
      setFilteredDebonned(sortedDebonned);
    } catch (error) {
      console.error("Failed to load stock", error);
      setStock([]);
      setFilteredStock([]);
      setDebonnedStock([]);
      setFilteredDebonned([]);
    }
  };
  useEffect(() => {
    if (stockSearchText.trim() === "") setFilteredStock(stock);
    else
      setFilteredStock(
        stock.filter(
          (item) =>
            item.batchCode &&
            item.batchCode
              .slice(-3)
              .toLowerCase()
              .includes(stockSearchText.toLowerCase()),
        ),
      );
  }, [stockSearchText, stock]);
  useEffect(() => {
    if (debonnedSearchText.trim() === "") setFilteredDebonned(debonnedStock);
    else
      setFilteredDebonned(
        debonnedStock.filter(
          (item) =>
            item.batchCode &&
            item.batchCode
              .slice(-3)
              .toLowerCase()
              .includes(debonnedSearchText.toLowerCase()),
        ),
      );
  }, [debonnedSearchText, debonnedStock]);
  useEffect(() => {
    if (removalsSearchText.trim() === "") setFilteredRemovals(removals);
    else
      setFilteredRemovals(
        removals.filter(
          (item) =>
            item.batchCode &&
            item.batchCode
              .slice(-3)
              .toLowerCase()
              .includes(removalsSearchText.toLowerCase()),
        ),
      );
  }, [removalsSearchText, removals]);
  const loadRemovals = async (storeValue) => {
    try {
      const stored = await AsyncStorage.getItem(REMOVALS_KEY);
      const allRemovals = stored ? JSON.parse(stored) : [];
      const filtered = allRemovals.filter(
        (r) =>
          r.store === storeValue && r.isCarcass === (storeValue === "cold"),
      );
      setRemovals(filtered);
      setFilteredRemovals(filtered);
    } catch (error) {
      console.error("Failed to load removals", error);
      setRemovals([]);
      setFilteredRemovals([]);
    }
  };
  const handleSelectStore = (storeValue) => {
    setSelectedStore(storeValue);
    loadStock(storeValue);
    loadRemovals(storeValue);
    setStockSearchText("");
    setDebonnedSearchText("");
    setRemovalsSearchText("");
  };
  const onRefresh = async () => {
    if (selectedStore) {
      setRefreshing(true);
      await Promise.all([
        loadStock(selectedStore),
        loadRemovals(selectedStore),
      ]);
      setRefreshing(false);
    }
  };
  const addStore = async () => {
    const name = newStoreName.trim();
    if (!name) {
      ToastAndroid.show("Please enter a store name", ToastAndroid.SHORT);
      return;
    }
    let value = name
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_]/g, "");
    if (!value) value = `store_${Date.now()}`;
    let finalValue = value;
    let counter = 1;
    while (stores.some((s) => s.value === finalValue))
      finalValue = `${value}_${counter++}`;
    const newStore = { label: name, value: finalValue };
    const updatedStores = [...stores, newStore];
    setStores(updatedStores);
    setNewStoreName("");
    setManageStoresVisible(false);
    ToastAndroid.show(`Store "${name}" added`, ToastAndroid.SHORT);
  };
  const deleteStore = async (storeValue, storeLabel) => {
    if (stores.length === 1) {
      ToastAndroid.show("Cannot delete the last store", ToastAndroid.SHORT);
      return;
    }
    const updatedStores = stores.filter((s) => s.value !== storeValue);
    setStores(updatedStores);
    const stockKey = getStockKeyForStore(storeValue);
    try {
      await AsyncStorage.removeItem(stockKey);
    } catch (e) {
      console.error("Failed to remove stock for deleted store", e);
    }
    if (selectedStore === storeValue) {
      setSelectedStore(null);
      setStock([]);
      setRemovals([]);
      setDebonnedStock([]);
    }
    ToastAndroid.show(`Store "${storeLabel}" deleted`, ToastAndroid.SHORT);
  };
  const handleRemove = (item) => {
    setSelectedItem(item);
    setRemoveWeight("");
    setRemovalReason("");
    setRemovalModalVisible(true);
  };
  const confirmRemoval = async () => {
    const isColdroom = selectedStore === "cold";
    if (isColdroom) {
      const weightToRemove = parseFloat(removeWeight);
      if (isNaN(weightToRemove) || weightToRemove <= 0) {
        ToastAndroid.show(
          "Please enter a valid weight (kg)",
          ToastAndroid.SHORT,
        );
        return;
      }
      if (
        weightToRemove >
        (selectedItem.currentWeight || selectedItem.totalWeight)
      ) {
        ToastAndroid.show("Not enough stock", ToastAndroid.SHORT);
        return;
      }
      const reason = removalReason.trim();
      if (reason === "") {
        ToastAndroid.show(
          "Please enter a reason for removal",
          ToastAndroid.SHORT,
        );
        return;
      }
      const oldTotalWeight =
        selectedItem.currentWeight || selectedItem.totalWeight;
      const newTotalWeight = oldTotalWeight - weightToRemove;
      const isDebonned = selectedItem.isDebonned === true;
      let updatedStock = [...stock];
      let updatedDebonnedStock = [...debonnedStock];
      let stockKey = getStockKeyForStore(selectedStore);
      let allStock = [];
      if (isDebonned) {
        const index = updatedDebonnedStock.findIndex(
          (i) => i.id === selectedItem.id,
        );
        if (index !== -1) {
          updatedDebonnedStock[index].currentWeight = newTotalWeight;
          updatedDebonnedStock[index].totalWeight = newTotalWeight;
          updatedDebonnedStock[index].lastUpdated = new Date().toISOString();
          updatedDebonnedStock[index].removalReason = reason;
          if (newTotalWeight <= 0) updatedDebonnedStock.splice(index, 1);
          setDebonnedStock(updatedDebonnedStock);
          allStock = [...updatedStock, ...updatedDebonnedStock];
          await AsyncStorage.setItem(stockKey, JSON.stringify(allStock));
        }
      } else {
        const index = updatedStock.findIndex((i) => i.id === selectedItem.id);
        if (index !== -1) {
          updatedStock[index].totalWeight = newTotalWeight;
          updatedStock[index].lastUpdated = new Date().toISOString();
          updatedStock[index].removalReason = reason;
          if (newTotalWeight <= 0) updatedStock.splice(index, 1);
          setStock(updatedStock);
          allStock = [...updatedStock, ...updatedDebonnedStock];
          await AsyncStorage.setItem(stockKey, JSON.stringify(allStock));
          const spoilageRecord = {
            id: Date.now().toString(),
            batchCode: selectedItem.batchCode,
            carcassType: selectedItem.type,
            receivedWeight:
              selectedItem.originalReceivedWeight ||
              selectedItem.totalWeight + weightToRemove,
            currentWeight: newTotalWeight,
            pieces: selectedItem.pieces,
            weightRemoved: weightToRemove,
            reason: reason,
            date: new Date().toLocaleString(),
          };
          const spoilageStored = await AsyncStorage.getItem(
            SPOILAGE_REMOVALS_KEY,
          );
          let spoilageList = spoilageStored ? JSON.parse(spoilageStored) : [];
          spoilageList.unshift(spoilageRecord);
          await AsyncStorage.setItem(
            SPOILAGE_REMOVALS_KEY,
            JSON.stringify(spoilageList),
          );
          syncToFirebase(
            "spoilageRecords",
            spoilageRecord,
            store.getState().settings.BusinessId,
          );
        }
      }
      const removalRecord = {
        id: Date.now().toString(),
        store: selectedStore,
        itemId: selectedItem.id,
        type: selectedItem.type,
        weightRemoved: weightToRemove,
        batchCode: selectedItem.batchCode || "",
        reason: reason,
        date: new Date().toLocaleString(),
        isCarcass: true,
        isColdroom: true,
        isDebonned: isDebonned,
        remainingWeight: newTotalWeight,
      };
      let removalsList = await AsyncStorage.getItem(REMOVALS_KEY);
      removalsList = removalsList ? JSON.parse(removalsList) : [];
      removalsList.unshift(removalRecord);
      await AsyncStorage.setItem(REMOVALS_KEY, JSON.stringify(removalsList));
      syncToFirebase(
        "stockRemovals",
        removalRecord,
        store.getState().settings.BusinessId,
      );
      loadRemovals(selectedStore);
      ToastAndroid.show(
        `Removed ${weightToRemove.toFixed(3)} kg from ${selectedItem.type}. Remaining: ${newTotalWeight.toFixed(3)} kg`,
        ToastAndroid.LONG,
      );
      setRemovalModalVisible(false);
      setSelectedItem(null);
      setRemoveWeight("");
      setRemovalReason("");
    } else {
      const weightToRemove = parseFloat(removeWeight);
      if (isNaN(weightToRemove) || weightToRemove <= 0) {
        ToastAndroid.show(
          "Please enter a valid weight (kg)",
          ToastAndroid.SHORT,
        );
        return;
      }
      if (weightToRemove > selectedItem.totalWeight) {
        ToastAndroid.show("Not enough stock", ToastAndroid.SHORT);
        return;
      }
      const reason = removalReason.trim();
      if (reason === "") {
        ToastAndroid.show(
          "Please enter a reason for removal",
          ToastAndroid.SHORT,
        );
        return;
      }
      const updatedStock = [...stock];
      const index = updatedStock.findIndex((i) => i.id === selectedItem.id);
      if (index !== -1) {
        updatedStock[index].totalWeight -= weightToRemove;
        if (updatedStock[index].totalWeight <= 0) updatedStock.splice(index, 1);
        else updatedStock[index].lastUpdated = new Date().toISOString();
        const stockKey = getStockKeyForStore(selectedStore);
        await AsyncStorage.setItem(stockKey, JSON.stringify(updatedStock));
        setStock(updatedStock);
        const removalRecord = {
          id: Date.now().toString(),
          store: selectedStore,
          itemId: selectedItem.id,
          type: selectedItem.type,
          weightRemoved: weightToRemove,
          batchCode: selectedItem.batchCode || "",
          reason: reason,
          date: new Date().toLocaleString(),
          isCarcass: false,
          isColdroom: false,
        };
        let removalsList = await AsyncStorage.getItem(REMOVALS_KEY);
        removalsList = removalsList ? JSON.parse(removalsList) : [];
        removalsList.unshift(removalRecord);
        await AsyncStorage.setItem(REMOVALS_KEY, JSON.stringify(removalsList));
        syncToFirebase(
          "stockRemovals",
          removalRecord,
          store.getState().settings.BusinessId,
        );
        loadRemovals(selectedStore);
        ToastAndroid.show(
          `Removed ${weightToRemove.toFixed(3)} kg`,
          ToastAndroid.SHORT,
        );
        setRemovalModalVisible(false);
        setSelectedItem(null);
        setRemoveWeight("");
        setRemovalReason("");
      }
    }
  };

  if (selectedStore) {
    const storeLabel =
      stores.find((s) => s.value === selectedStore)?.label || selectedStore;
    const isColdroom = selectedStore === "cold";
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: "#F9F9F9" }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <View style={styles.storageContainer}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => setSelectedStore(null)}
          >
            <Text style={styles.backButtonText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.dryGoodsTitle}>{storeLabel}</Text>
          <TouchableOpacity
            style={styles.refreshButtonSmall}
            onPress={onRefresh}
          >
            <Text style={styles.refreshButtonSmallText}>↻ Refresh</Text>
          </TouchableOpacity>
          <Text style={styles.sectionHeader}>
            {isColdroom
              ? "First Weight Carcasses In-Stock"
              : `Weight of ${storeLabel} in-stock`}
          </Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search by last 3 digits of batch no..."
            value={stockSearchText}
            onChangeText={setStockSearchText}
          />
          <FlatList
            data={filteredStock}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <View style={styles.stockItem}>
                <View style={styles.stockDetails}>
                  <Text style={styles.stockType}>{item.type}</Text>
                  {item.batchCode && (
                    <Text style={styles.stockInfo}>
                      Batch No: {item.batchCode}
                    </Text>
                  )}
                  <Text style={styles.stockInfo}>
                    Received Weight:{" "}
                    {item.originalReceivedWeight
                      ? item.originalReceivedWeight.toFixed(3)
                      : item.totalWeight.toFixed(3)}{" "}
                    kg
                  </Text>
                  <Text style={styles.stockInfo}>
                    Current Weight:{" "}
                    {item.totalWeight ? item.totalWeight.toFixed(3) : "0.000"}{" "}
                    kg
                  </Text>
                  <Text style={styles.stockInfo}>Pieces: {item.pieces}</Text>
                  <Text style={styles.stockInfo}>
                    Reason for removal: {item.removalReason || "N/A"}
                  </Text>
                  <Text style={styles.stockDate}>
                    Last updated: {new Date(item.lastUpdated).toLocaleString()}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.removeButton}
                  onPress={() => handleRemove(item)}
                >
                  <Text style={styles.removeButtonText}>Remove</Text>
                </TouchableOpacity>
              </View>
            )}
            ListEmptyComponent={
              <Text style={styles.emptyText}>No stock available</Text>
            }
            scrollEnabled={false}
          />
          {isColdroom && (
            <>
              <Text style={styles.recordsHeader}>
                After Debonning Weight Records
              </Text>
              <TextInput
                style={styles.searchInput}
                placeholder="Search by last 3 digits of batch no..."
                value={debonnedSearchText}
                onChangeText={setDebonnedSearchText}
              />
              <FlatList
                data={filteredDebonned}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => {
                  const varianceColor =
                    item.variance >= 0 ? "#4CAF50" : "#FF4444";
                  const varianceSign = item.variance >= 0 ? "+" : "";
                  const currentWeightDisplay =
                    item.currentWeight ||
                    item.weightAfterDebonning ||
                    item.totalWeight;
                  const weightAfterDebonningDisplay =
                    item.weightAfterDebonning || item.totalWeight;
                  return (
                    <View
                      style={[styles.stockItem, { backgroundColor: "#E8F4FD" }]}
                    >
                      <View style={styles.stockDetails}>
                        <Text style={styles.stockType}>{item.type}</Text>
                        <Text style={styles.stockInfo}>
                          Batch No: {item.batchCode}
                        </Text>
                        <Text style={styles.stockInfo}>
                          Received Weight:{" "}
                          {item.originalReceivedWeight
                            ? item.originalReceivedWeight.toFixed(3)
                            : "0.000"}{" "}
                          kg
                        </Text>
                        <Text style={styles.stockInfo}>
                          Weight Before Debonning:{" "}
                          {item.weightBeforeDebonning
                            ? item.weightBeforeDebonning.toFixed(3)
                            : "0.000"}{" "}
                          kg
                        </Text>
                        <Text style={styles.stockInfo}>
                          Weight After Debonning:{" "}
                          {weightAfterDebonningDisplay.toFixed(3)} kg
                        </Text>
                        <Text style={styles.stockInfo}>
                          Current Weight: {currentWeightDisplay.toFixed(3)} kg
                        </Text>
                        <Text
                          style={[
                            styles.stockInfo,
                            { color: varianceColor, fontWeight: "bold" },
                          ]}
                        >
                          Variance: {varianceSign}
                          {item.variance?.toFixed(3)} kg ({item.variancePercent}
                          %)
                        </Text>
                        <Text style={styles.stockDate}>
                          Timestamp:{" "}
                          {item.timestamp ||
                            new Date(item.lastUpdated).toLocaleString()}
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={styles.removeButton}
                        onPress={() => handleRemove(item)}
                      >
                        <Text style={styles.removeButtonText}>Remove</Text>
                      </TouchableOpacity>
                    </View>
                  );
                }}
                ListEmptyComponent={
                  <Text style={styles.emptyText}>No debonned meat records</Text>
                }
                scrollEnabled={false}
              />
            </>
          )}
          <Text style={styles.recordsHeader}>
            {isColdroom
              ? "Deleted Carcasses Records"
              : `Deleted ${storeLabel} Records`}
          </Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search by last 3 digits of batch no..."
            value={removalsSearchText}
            onChangeText={setRemovalsSearchText}
          />
          <FlatList
            data={filteredRemovals}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <View style={styles.deletedRecordItem}>
                <View style={styles.deletedRecordDetails}>
                  <Text style={styles.deletedRecordType}>{item.type}</Text>
                  {item.batchCode && item.batchCode !== "" && (
                    <Text style={styles.deletedRecordInfo}>
                      Batch: {item.batchCode}
                    </Text>
                  )}
                  {item.isColdroom ? (
                    <>
                      <Text style={styles.deletedRecordInfo}>
                        Weight Removed:{" "}
                        {item.weightRemoved
                          ? item.weightRemoved.toFixed(3)
                          : "0.000"}{" "}
                        kg
                      </Text>
                      {item.isDebonned && (
                        <Text style={styles.deletedRecordInfo}>
                          (Debonned Meat)
                        </Text>
                      )}
                      {item.remainingWeight !== undefined && (
                        <Text style={styles.deletedRecordInfo}>
                          Remaining Weight: {item.remainingWeight.toFixed(3)} kg
                        </Text>
                      )}
                    </>
                  ) : (
                    <Text style={styles.deletedRecordInfo}>
                      Weight Removed:{" "}
                      {item.weightRemoved
                        ? item.weightRemoved.toFixed(3)
                        : "0.000"}{" "}
                      kg
                    </Text>
                  )}
                  <Text style={styles.deletedRecordInfo}>
                    Reason: {item.reason || "N/A"}
                  </Text>
                  <Text style={styles.deletedRecordDate}>
                    {item.date || new Date().toLocaleString()}
                  </Text>
                </View>
              </View>
            )}
            ListEmptyComponent={
              <Text style={styles.emptyText}>No deletion records found</Text>
            }
            scrollEnabled={false}
          />
        </View>
        <Modal
          animationType="slide"
          transparent
          visible={removalModalVisible}
          onRequestClose={() => setRemovalModalVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Remove Stock</Text>
              <Text style={styles.modalSubtitle}>
                Item: {selectedItem?.type}
              </Text>
              {selectedItem?.batchCode && (
                <Text style={styles.modalSubtitle}>
                  Batch: {selectedItem.batchCode}
                </Text>
              )}
              <Text style={styles.modalSubtitle}>
                Received Weight:{" "}
                {(
                  selectedItem?.originalReceivedWeight ||
                  selectedItem?.totalWeight
                )?.toFixed(3) || "0.000"}{" "}
                kg
              </Text>
              <Text style={styles.modalSubtitle}>
                Current Weight:{" "}
                {(
                  selectedItem?.currentWeight || selectedItem?.totalWeight
                )?.toFixed(3) || "0.000"}{" "}
                kg
              </Text>
              {!selectedItem?.isDebonned && (
                <Text style={styles.modalSubtitle}>
                  Pieces: {selectedItem?.pieces || 0}
                </Text>
              )}
              <TextInput
                style={styles.inputField}
                placeholder="Weight to remove (kg)"
                value={removeWeight}
                onChangeText={setRemoveWeight}
                keyboardType="decimal-pad"
              />
              <TextInput
                style={styles.inputField}
                placeholder="Reason for removal (required)"
                value={removalReason}
                onChangeText={setRemovalReason}
              />
              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={[styles.modalButton, { backgroundColor: "#FF4444" }]}
                  onPress={confirmRemoval}
                >
                  <Text style={styles.modalButtonText}>Confirm Removal</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalButton, { backgroundColor: "#888" }]}
                  onPress={() => setRemovalModalVisible(false)}
                >
                  <Text style={styles.modalButtonText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </ScrollView>
    );
  }
  return (
    <View style={styles.storageContainer}>
      <TouchableOpacity style={styles.backButton} onPress={onClose}>
        <Text style={styles.backButtonText}>← Back</Text>
      </TouchableOpacity>
      <Text style={styles.storageTitle}>Storage Management</Text>
      {stores.map((store) => (
        <TouchableOpacity
          key={store.value}
          style={styles.storageOption}
          onPress={() => handleSelectStore(store.value)}
        >
          <Text style={styles.storageOptionText}>{store.label}</Text>
        </TouchableOpacity>
      ))}
      <TouchableOpacity
        style={[styles.storageOption, { backgroundColor: "#FFA500" }]}
        onPress={() => setManageStoresVisible(true)}
      >
        <Text style={styles.storageOptionText}>Manage Stores</Text>
      </TouchableOpacity>
      <Modal
        animationType="slide"
        transparent
        visible={manageStoresVisible}
        onRequestClose={() => setManageStoresVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Manage Stores</Text>
            <TextInput
              style={styles.inputField}
              placeholder="New store name"
              value={newStoreName}
              onChangeText={setNewStoreName}
            />
            <TouchableOpacity
              style={[styles.saveButton, { marginTop: 0, marginBottom: 15 }]}
              onPress={addStore}
            >
              <Text style={styles.saveButtonText}>Add Store</Text>
            </TouchableOpacity>
            <Text style={[styles.sectionHeader, { marginTop: 10 }]}>
              Existing Stores
            </Text>
            <FlatList
              data={stores}
              keyExtractor={(item) => item.value}
              renderItem={({ item }) => (
                <View style={styles.stockItem}>
                  <View style={styles.stockDetails}>
                    <Text style={styles.stockType}>{item.label}</Text>
                    <Text style={styles.stockInfo}>ID: {item.value}</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.removeButton}
                    onPress={() => deleteStore(item.value, item.label)}
                  >
                    <Text style={styles.removeButtonText}>Delete</Text>
                  </TouchableOpacity>
                </View>
              )}
              style={{ maxHeight: 300 }}
              scrollEnabled={true}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: "#0066CC" }]}
                onPress={() => setManageStoresVisible(false)}
              >
                <Text style={styles.modalButtonText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

// ============ CARCASSES SCREEN (with manual piece count edit) ============
const CarcassesScreen = ({ onClose }) => {
  const [carcassType, setCarcassType] = useState("");
  const [capturedRecords, setCapturedRecords] = useState([]);
  const [savedSessions, setSavedSessions] = useState([]);
  const [filteredSessions, setFilteredSessions] = useState([]);
  const [searchText, setSearchText] = useState("");
  const [deletedRecords, setDeletedRecords] = useState([]);
  const [filteredDeleted, setFilteredDeleted] = useState([]);
  const [deletedSearchText, setDeletedSearchText] = useState("");
  const [selectedStore, setSelectedStore] = useState("cold");
  const [stores, setStores] = useState([]);
  const [savedCount, setSavedCount] = useState(0);
  const [batchCode, setBatchCode] = useState("");
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const { receivedData } = useBluetooth();
  const [scaleData, setScaleData] = useState({
    reading: null,
    isStable: false,
  });
  const [pieceCount, setPieceCount] = useState(0);
  const previousWeight = useRef(0);
  const isCountingEnabled = useRef(true);
  const MIN_PIECE_WEIGHT = 0.05;
  const isFirstCaptureAfterReset = useRef(true);
  const [isManualEditing, setIsManualEditing] = useState(false);

  useEffect(() => {
    const initialize = async () => {
      try {
        const storedStores = await AsyncStorage.getItem(STORAGE_STORES_KEY);
        if (storedStores) {
          const parsed = JSON.parse(storedStores);
          setStores(parsed);
          if (
            !parsed.some((s) => s.value === selectedStore) &&
            parsed.length > 0
          )
            setSelectedStore(parsed[0].value);
        } else {
          const defaultStores = [
            { label: "Dry Goods Store", value: "dry" },
            { label: "Coldroom", value: "cold" },
          ];
          setStores(defaultStores);
          await AsyncStorage.setItem(
            STORAGE_STORES_KEY,
            JSON.stringify(defaultStores),
          );
        }
        let counter = await AsyncStorage.getItem(CARCASS_BATCH_COUNTER_KEY);
        counter = counter ? parseInt(counter) : 0;
        setSavedCount(counter);
        setBatchCode(formatBatchCode(counter + 1));
      } catch (error) {
        console.error("Failed to initialize carcass screen", error);
      }
    };
    initialize();
  }, []);
  const loadSessions = async () => {
    try {
      const stored = await AsyncStorage.getItem(CARCASS_SESSIONS_KEY);
      if (stored) {
        let parsed = JSON.parse(stored);
        if (!Array.isArray(parsed)) parsed = [];
        parsed = parsed.map((session) => ({
          ...session,
          captures: Array.isArray(session.captures) ? session.captures : [],
        }));
        setSavedSessions(parsed);
        setFilteredSessions(parsed);
      } else {
        setSavedSessions([]);
        setFilteredSessions([]);
      }
    } catch (error) {
      console.error("Failed to load carcass sessions", error);
      setSavedSessions([]);
      setFilteredSessions([]);
    }
  };
  const loadDeletions = async () => {
    try {
      const stored = await AsyncStorage.getItem(CARCASS_DELETIONS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        setDeletedRecords(Array.isArray(parsed) ? parsed : []);
        setFilteredDeleted(Array.isArray(parsed) ? parsed : []);
      } else {
        setDeletedRecords([]);
        setFilteredDeleted([]);
      }
    } catch (error) {
      console.error("Failed to load carcass deletions", error);
      setDeletedRecords([]);
      setFilteredDeleted([]);
    }
  };
  useEffect(() => {
    loadSessions();
    loadDeletions();
  }, []);
  useEffect(() => {
    if (searchText.trim() === "") setFilteredSessions(savedSessions);
    else
      setFilteredSessions(
        savedSessions.filter(
          (item) =>
            item.batchCode &&
            item.batchCode
              .slice(-3)
              .toLowerCase()
              .includes(searchText.toLowerCase()),
        ),
      );
  }, [searchText, savedSessions]);
  useEffect(() => {
    if (deletedSearchText.trim() === "") setFilteredDeleted(deletedRecords);
    else
      setFilteredDeleted(
        deletedRecords.filter(
          (item) =>
            item.batchCode &&
            item.batchCode
              .slice(-3)
              .toLowerCase()
              .includes(deletedSearchText.toLowerCase()),
        ),
      );
  }, [deletedSearchText, deletedRecords]);
  useEffect(() => {
    const scaleAddress = store.getState().settings.scaleAddress;
    if (scaleAddress)
      RNBluetooth.connectToDevice(scaleAddress).catch(console.error);
  }, []);
  useEffect(() => {
    if (receivedData) {
      let numericValue = null;
      if (typeof receivedData === "string") {
        try {
          const decodedData = atob(receivedData);
          const match = decodedData.match(/-?\d+(\.\d+)?/);
          if (match) numericValue = parseFloat(match[0]);
        } catch {
          const match = receivedData.match(/-?\d+(\.\d+)?/);
          if (match) numericValue = parseFloat(match[0]);
        }
      } else if (typeof receivedData === "number") numericValue = receivedData;
      const newScaleData =
        numericValue !== null && !isNaN(numericValue)
          ? { reading: numericValue.toFixed(2) + "kg", isStable: true }
          : { reading: null, isStable: true };
      setScaleData(newScaleData);
    }
  }, [receivedData]);
  useEffect(() => {
    if (isManualEditing) return;
    if (
      scaleData.isStable &&
      scaleData.reading !== null &&
      isCountingEnabled.current
    ) {
      const currentWeight =
        parseFloat(scaleData.reading.replace("kg", "")) || 0;
      const weightChange = currentWeight - previousWeight.current;
      if (weightChange > MIN_PIECE_WEIGHT && currentWeight > MIN_PIECE_WEIGHT) {
        isCountingEnabled.current = false;
        setPieceCount((prev) => prev + 1);
        ToastAndroid.show(
          `✓ Added carcass (${weightChange.toFixed(2)} kg)`,
          ToastAndroid.SHORT,
        );
        previousWeight.current = currentWeight;
        setTimeout(() => {
          isCountingEnabled.current = true;
        }, 2000);
      } else if (
        weightChange < -MIN_PIECE_WEIGHT &&
        pieceCount > 0 &&
        !isFirstCaptureAfterReset.current
      ) {
        isCountingEnabled.current = false;
        setPieceCount((prev) => prev - 1);
        ToastAndroid.show(
          `✓ Removed carcass (${Math.abs(weightChange).toFixed(2)} kg)`,
          ToastAndroid.SHORT,
        );
        previousWeight.current = currentWeight;
        setTimeout(() => {
          isCountingEnabled.current = true;
        }, 2000);
      }
      if (Math.abs(weightChange) < 0.1) previousWeight.current = currentWeight;
    }
  }, [scaleData, pieceCount, isManualEditing]);
  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadSessions(), loadDeletions()]);
    setRefreshing(false);
  };
  const handleCapture = () => {
    if (!scaleData.reading || !scaleData.isStable) {
      ToastAndroid.show("Wait for stable reading", ToastAndroid.SHORT);
      return;
    }
    if (pieceCount === 0) {
      ToastAndroid.show("No carcasses to capture", ToastAndroid.SHORT);
      return;
    }
    const currentWeight = parseFloat(scaleData.reading.replace("kg", "")) || 0;
    const newRecord = {
      id: Date.now().toString(),
      pieces: pieceCount,
      totalWeight: currentWeight,
      timestamp: new Date().toLocaleString(),
    };
    setCapturedRecords((prev) => [...prev, newRecord]);
    ToastAndroid.show(
      `Captured ${pieceCount} pieces, ${currentWeight.toFixed(2)} kg`,
      ToastAndroid.SHORT,
    );
    setPieceCount(0);
    previousWeight.current = 0;
    isCountingEnabled.current = true;
    isFirstCaptureAfterReset.current = true;
    setTimeout(() => {
      isFirstCaptureAfterReset.current = false;
    }, 500);
  };
  const deleteCapture = (id) => {
    setCapturedRecords((prev) => prev.filter((r) => r.id !== id));
    ToastAndroid.show("Capture deleted", ToastAndroid.SHORT);
  };
  const handleSave = async () => {
    if (!carcassType.trim()) {
      ToastAndroid.show("Please enter carcass type", ToastAndroid.SHORT);
      return;
    }
    if (capturedRecords.length === 0) {
      ToastAndroid.show("No carcasses to save", ToastAndroid.SHORT);
      return;
    }
    const totalPieces = capturedRecords.reduce(
      (sum, cap) => sum + cap.pieces,
      0,
    );
    const totalWeightSum = capturedRecords.reduce(
      (sum, cap) => sum + cap.totalWeight,
      0,
    );
    const newSession = {
      id: Date.now().toString(),
      batchCode,
      store: selectedStore,
      carcassType: carcassType.trim(),
      captures: capturedRecords,
      totalPieces,
      totalWeight: totalWeightSum,
      date: new Date().toLocaleString(),
    };
    const updatedSessions = [newSession, ...savedSessions];
    setSavedSessions(updatedSessions);
    try {
      await AsyncStorage.setItem(
        CARCASS_SESSIONS_KEY,
        JSON.stringify(updatedSessions),
      );
      syncToFirebase(
        "carcassSessions",
        newSession,
        store.getState().settings.BusinessId,
      );
      const stockKey = getStockKeyForStore(selectedStore);
      const stock = await AsyncStorage.getItem(stockKey);
      let stockList = stock ? JSON.parse(stock) : [];
      stockList.push({
        id: Date.now().toString(),
        type: carcassType.trim(),
        pieces: totalPieces,
        totalWeight: totalWeightSum,
        batchCode: batchCode,
        lastUpdated: new Date().toISOString(),
        isDebonned: false,
        originalReceivedWeight: totalWeightSum,
      });
      await AsyncStorage.setItem(stockKey, JSON.stringify(stockList));
      const storeLabel =
        stores.find((s) => s.value === selectedStore)?.label || selectedStore;
      ToastAndroid.show(
        `Carcass session saved to ${storeLabel}`,
        ToastAndroid.SHORT,
      );
    } catch (error) {
      console.error("Failed to save carcass session", error);
    }
    const newSavedCount = savedCount + 1;
    setSavedCount(newSavedCount);
    await AsyncStorage.setItem(
      CARCASS_BATCH_COUNTER_KEY,
      newSavedCount.toString(),
    );
    setBatchCode(formatBatchCode(newSavedCount + 1));
    setCarcassType("");
    setCapturedRecords([]);
  };
  const requestDeleteSession = (session) => {
    setSessionToDelete(session);
    setDeleteReason("");
    setDeleteModalVisible(true);
  };
  const confirmDeleteSession = async () => {
    if (!deleteReason.trim()) {
      ToastAndroid.show(
        "Please provide a reason for deletion",
        ToastAndroid.SHORT,
      );
      return;
    }
    const session = sessionToDelete;
    if (!session) return;
    const updatedSessions = savedSessions.filter((s) => s.id !== session.id);
    setSavedSessions(updatedSessions);
    const deletionRecord = {
      id: Date.now().toString(),
      sessionId: session.id,
      batchCode: session.batchCode || "",
      carcassType: session.carcassType || "",
      store: session.store || "",
      totalPieces: session.totalPieces || 0,
      totalWeight: session.totalWeight || 0,
      originalDate: session.date || "",
      reason: deleteReason.trim(),
      deletedAt: new Date().toLocaleString(),
    };
    try {
      await AsyncStorage.setItem(
        CARCASS_SESSIONS_KEY,
        JSON.stringify(updatedSessions),
      );
      const storedDeletions = await AsyncStorage.getItem(CARCASS_DELETIONS_KEY);
      const allDeletions = storedDeletions ? JSON.parse(storedDeletions) : [];
      const updatedDeletions = [deletionRecord, ...allDeletions];
      await AsyncStorage.setItem(
        CARCASS_DELETIONS_KEY,
        JSON.stringify(updatedDeletions),
      );
      setDeletedRecords(updatedDeletions);
      syncToFirebase(
        "deletedRecords",
        deletionRecord,
        store.getState().settings.BusinessId,
      );
      const stockKey = getStockKeyForStore(session.store);
      const stockRaw = await AsyncStorage.getItem(stockKey);
      let stockList = stockRaw ? JSON.parse(stockRaw) : [];
      const index = stockList.findIndex(
        (item) =>
          item.batchCode === session.batchCode &&
          item.type === session.carcassType,
      );
      if (index !== -1) {
        stockList.splice(index, 1);
        await AsyncStorage.setItem(stockKey, JSON.stringify(stockList));
      }
      ToastAndroid.show("Session deleted and recorded", ToastAndroid.SHORT);
    } catch (error) {
      console.error("Failed to delete carcass session", error);
    }
    setDeleteModalVisible(false);
    setSessionToDelete(null);
    setDeleteReason("");
  };
  const renderCaptureItem = ({ item }) => (
    <View style={styles.captureItem}>
      <View style={styles.captureDetails}>
        <Text style={styles.captureText}>
          {item.pieces} pieces – {item.totalWeight.toFixed(2)} kg
        </Text>
        <Text style={styles.captureDate}>{item.timestamp}</Text>
      </View>
      <TouchableOpacity
        onPress={() => deleteCapture(item.id)}
        style={styles.deleteButton}
      >
        <Text style={styles.deleteButtonText}>X</Text>
      </TouchableOpacity>
    </View>
  );
  const renderSessionItem = ({ item }) => {
    const storeLabel =
      stores.find((s) => s.value === item.store)?.label || item.store;
    return (
      <View style={styles.sessionItem}>
        <View style={styles.sessionDetails}>
          <Text style={styles.sessionType}>{item.carcassType}</Text>
          <Text style={styles.sessionInfo}>
            Batch: {item.batchCode} | {item.totalPieces} pieces |{" "}
            {item.totalWeight.toFixed(2)} kg
          </Text>
          <Text style={styles.sessionStore}>Store: {storeLabel}</Text>
          <Text style={styles.sessionInfo}>{item.date}</Text>
        </View>
        <TouchableOpacity
          onPress={() => requestDeleteSession(item)}
          style={styles.deleteButton}
        >
          <Text style={styles.deleteButtonText}>Delete</Text>
        </TouchableOpacity>
      </View>
    );
  };
  const renderDeletedRecord = ({ item }) => {
    const storeLabel =
      stores.find((s) => s.value === item.store)?.label || item.store || "—";
    return (
      <View style={styles.deletedRecordItem}>
        <View style={styles.deletedRecordDetails}>
          <Text style={styles.deletedRecordType}>{item.carcassType}</Text>
          {item.batchCode ? (
            <Text style={styles.deletedRecordInfo}>
              Batch: {item.batchCode}
            </Text>
          ) : null}
          <Text style={styles.deletedRecordInfo}>
            {item.totalPieces} pieces | {(item.totalWeight || 0).toFixed(2)} kg
          </Text>
          <Text style={styles.deletedRecordInfo}>Store: {storeLabel}</Text>
          <Text style={styles.deletedRecordReason}>Reason: {item.reason}</Text>
          <Text style={styles.deletedRecordDate}>
            Deleted: {item.deletedAt}
          </Text>
          <Text style={styles.deletedRecordDate}>
            Original date: {item.originalDate}
          </Text>
        </View>
      </View>
    );
  };
  const storeOptions = stores.map((s) => ({ label: s.label, value: s.value }));
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: "#F9F9F9" }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      <View style={styles.dryGoodsContainer}>
        <TouchableOpacity style={styles.backButton} onPress={onClose}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <View style={styles.formContainer}>
          <DropdownComponent
            title="Store"
            onChange={(item) => setSelectedStore(item.value)}
            data={storeOptions}
            value={storeOptions.find((opt) => opt.value === selectedStore)}
            placeholder="Select Store"
          />
          <TextInput
            style={styles.inputField}
            placeholder="Carcass Type (e.g., Beef, Lamb)"
            value={carcassType}
            onChangeText={setCarcassType}
          />
          <View style={styles.batchCodeContainer}>
            <Text style={styles.batchCodeLabel}>Batch Code:</Text>
            <Text style={styles.batchCodeValue}>{batchCode}</Text>
          </View>
          <View
            style={[
              styles.display,
              { backgroundColor: scaleData.isStable ? "green" : "red" },
            ]}
          >
            <View style={styles.data}>
              <Text style={styles.textBold}>Scale:</Text>
              <Text style={styles.textRegular}>
                {scaleData.reading ? "Connected" : "Disconnected"}
              </Text>
              <Text style={styles.textBold}>Stability:</Text>
              <Text style={styles.textRegular}>
                {scaleData.isStable ? "Stable" : "Unstable"}
              </Text>
            </View>
            <View>
              <Text style={styles.textWeight}>
                {scaleData.reading || "0.00 kg"}
              </Text>
            </View>
          </View>
          <View style={styles.summaryRow}>
            <View style={styles.summaryBox}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <Text style={styles.summaryText}>Current pieces: </Text>
                <TextInput
                  style={[
                    styles.summaryText,
                    {
                      width: 80,
                      borderBottomWidth: 1,
                      borderColor: "#CCC",
                      textAlign: "center",
                    },
                  ]}
                  keyboardType="numeric"
                  value={pieceCount.toString()}
                  onFocus={() => setIsManualEditing(true)}
                  onBlur={() =>
                    setTimeout(() => setIsManualEditing(false), 2000)
                  }
                  onChangeText={(text) => {
                    const num = text === "" ? 0 : parseInt(text);
                    if (!isNaN(num)) setPieceCount(num);
                  }}
                />
              </View>
            </View>
            <TouchableOpacity
              style={styles.resetButton}
              onPress={() => {
                setPieceCount(0);
                previousWeight.current = 0;
                isCountingEnabled.current = true;
                isFirstCaptureAfterReset.current = true;
                ToastAndroid.show("Counters reset", ToastAndroid.SHORT);
                setTimeout(() => {
                  isFirstCaptureAfterReset.current = false;
                }, 500);
              }}
            >
              <Text style={styles.resetButtonText}>Reset</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={[
              styles.captureButton,
              { backgroundColor: scaleData.isStable ? "#0066CC" : "#ccc" },
            ]}
            onPress={handleCapture}
            disabled={!scaleData.isStable}
          >
            <Text style={styles.captureButtonText}>Capture</Text>
          </TouchableOpacity>
          <Text style={styles.sectionHeader}>
            Captured Batches ({capturedRecords.length})
          </Text>
          <FlatList
            data={capturedRecords}
            keyExtractor={(item) => item.id}
            renderItem={renderCaptureItem}
            ListEmptyComponent={
              <Text style={styles.emptyText}>No batches captured yet</Text>
            }
            scrollEnabled={false}
          />
          <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
            <Text style={styles.saveButtonText}>Save Session</Text>
          </TouchableOpacity>
          <Text style={styles.recordsHeader}>Weight One Carcasses Records</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search by last 3 digits of batch no..."
            value={searchText}
            onChangeText={setSearchText}
          />
          <FlatList
            data={filteredSessions}
            keyExtractor={(item) => item.id}
            renderItem={renderSessionItem}
            ListEmptyComponent={
              <Text style={styles.emptyText}>No sessions yet</Text>
            }
            scrollEnabled={false}
          />
          <Text style={styles.recordsHeader}>
            Deleted Carcass Records ({deletedRecords.length})
          </Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search by last 3 digits of batch no..."
            value={deletedSearchText}
            onChangeText={setDeletedSearchText}
          />
          <FlatList
            data={filteredDeleted}
            keyExtractor={(item) => item.id}
            renderItem={renderDeletedRecord}
            ListEmptyComponent={
              <Text style={styles.emptyText}>No deleted records yet</Text>
            }
            scrollEnabled={false}
          />
          <View style={{ height: responsiveSize(20) }} />
        </View>
      </View>
      <Modal
        animationType="slide"
        transparent
        visible={deleteModalVisible}
        onRequestClose={() => setDeleteModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Delete Session</Text>
            {sessionToDelete && (
              <>
                <Text style={styles.modalSubtitle}>
                  Type: {sessionToDelete.carcassType}
                </Text>
                <Text style={styles.modalSubtitle}>
                  Batch: {sessionToDelete.batchCode}
                </Text>
                <Text style={styles.modalSubtitle}>
                  {sessionToDelete.totalPieces} pieces |{" "}
                  {(sessionToDelete.totalWeight || 0).toFixed(2)} kg
                </Text>
              </>
            )}
            <Text
              style={[
                styles.modalSubtitle,
                { marginTop: 12, color: "#CC0000" },
              ]}
            >
              A reason is required before deleting this record.
            </Text>
            <TextInput
              style={[styles.inputField, { marginTop: 10 }]}
              placeholder="Reason for deletion (required)"
              value={deleteReason}
              onChangeText={setDeleteReason}
              multiline
              numberOfLines={3}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: "#FF4444" }]}
                onPress={confirmDeleteSession}
              >
                <Text style={styles.modalButtonText}>Delete</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: "#888" }]}
                onPress={() => {
                  setDeleteModalVisible(false);
                  setSessionToDelete(null);
                  setDeleteReason("");
                }}
              >
                <Text style={styles.modalButtonText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
};

// ============ MAIN HOMEPAGE COMPONENT ============
const HomePage = () => {
  const dispatch = useDispatch();
  const navigation = useNavigation();
  const [refreshing, setRefreshing] = useState(false);
  const [selectedClient, setSelectedClient] = useState(null);
  const [selectedDestination, setSelectedDestination] = useState(null);
  const [batchCode, setBatchCode] = useState("");
  const [productsData, setProductsData] = useState([]);
  const [locationsData, setLocationsData] = useState([]);
  const [clientsData, setClientsData] = useState([]);
  const [fieldCollectionData, setFieldCollectionData] = useState([]);
  const { connectToDevice } = useBluetooth();
  const [carcasTypesData, setCarcasTypesData] = useState([]);
  const [selectedCarcasType, setSelectedCarcasType] = useState(null);
  const [showDryGoodsScreen, setShowDryGoodsScreen] = useState(false);
  const [showStorageScreen, setShowStorageScreen] = useState(false);
  const [showCarcassesScreen, setShowCarcassesScreen] = useState(false);
  const [showButcheryScreen, setShowButcheryScreen] = useState(false);
  const [showProcessingScreen, setShowProcessingScreen] = useState(false);
  const [showPackingScreen, setShowPackingScreen] = useState(false);
  const [customStoreScreens, setCustomStoreScreens] = useState([]);
  const [stores, setStores] = useState([]);
  const BusinessId = store.getState().settings.BusinessId;

  const generateBatchCode = async () => {
    try {
      const col = collection(db, `Businesses/${BusinessId}/FieldCollections`);
      const q = query(col, orderBy("batchCode", "desc"));
      const snap = await getDocs(q);
      let maxNumber = 0;
      snap.forEach((doc) => {
        const data = doc.data();
        if (data.batchCode) {
          const parts = data.batchCode.split("-");
          if (parts.length === 3) {
            const num = parseInt(parts[2]);
            if (!isNaN(num) && num > maxNumber) maxNumber = num;
          }
        }
      });
      const today = new Date();
      const dateStr = today.toISOString().slice(0, 10).replace(/-/g, "");
      const nextNumber = maxNumber + 1;
      const newCode = `BATCH-${dateStr}-${String(nextNumber).padStart(3, "0")}`;
      setBatchCode(newCode);
      return newCode;
    } catch (e) {
      const today = new Date();
      const dateStr = today.toISOString().slice(0, 10).replace(/-/g, "");
      const newCode = `BATCH-${dateStr}-001`;
      setBatchCode(newCode);
      return newCode;
    }
  };
  const generateNewBatchCode = async () => {
    await generateBatchCode();
    ToastAndroid.show("New batch code generated", ToastAndroid.SHORT);
  };
  const loadStores = useCallback(async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_STORES_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        setStores(parsed);
        const customStores = parsed.filter(
          (store) => store.value !== "dry" && store.value !== "cold",
        );
        setCustomStoreScreens(customStores);
      } else {
        const defaultStores = [
          { label: "Dry Goods Store", value: "dry" },
          { label: "Coldroom", value: "cold" },
        ];
        setStores(defaultStores);
        setCustomStoreScreens([]);
        await AsyncStorage.setItem(
          STORAGE_STORES_KEY,
          JSON.stringify(defaultStores),
        );
      }
    } catch (error) {
      console.error("Failed to load stores", error);
    }
  }, []);
  useEffect(() => {
    loadStores();
  }, [loadStores]);
  const getClients = useCallback(async () => {
    try {
      const snapshot = await getDocs(
        collection(db, `Businesses/${BusinessId}/Clients`),
      );
      const clients = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      const clientOptions = clients.map((client) => ({
        label: `${client.fName || ""} ${client.lName || ""}`.trim(),
        value: client.id,
        clientData: client,
      }));
      setClientsData(clientOptions);
      return clientOptions;
    } catch (error) {
      ToastAndroid.show("Error fetching clients", ToastAndroid.SHORT);
      return [];
    }
  }, [BusinessId]);
  const getLocations = useCallback(async () => {
    try {
      const snapshot = await getDocs(
        collection(db, `Businesses/${BusinessId}/Locations`),
      );
      const locations = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      dispatch(setLocations(locations));
      setLocationsData(
        locations.map((loc) => ({ label: loc.name, value: loc.id })),
      );
    } catch (error) {
      ToastAndroid.show("Error fetching locations", ToastAndroid.SHORT);
    }
  }, [BusinessId, dispatch]);
  const getProducts = useCallback(async () => {
    try {
      const productsCollection = collection(
        db,
        `Businesses/${BusinessId}/Products`,
      );
      const snapshot = await getDocs(productsCollection);
      const products = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      const stored = store.getState().settings.products || [];
      const merged = [
        ...stored,
        ...products.filter((p) => !stored.some((sp) => sp.id === p.id)),
      ];
      dispatch(setProducts(merged));
      setProductsData(
        merged.map((p) => ({
          isDukawala: p.isDukawala,
          price: p.price,
          label: p.name,
          value: p.id,
        })),
      );
    } catch (error) {
      ToastAndroid.show("Error fetching products", ToastAndroid.SHORT);
    }
  }, [BusinessId, dispatch]);
  const getFieldCollections = useCallback(async () => {
    try {
      const snapshot = await getDocs(
        collection(db, `Businesses/${BusinessId}/FieldCollections`),
      );
      const all = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      const clerkId = store.getState().settings.user.clerkId;
      const myRecords = all.filter((r) => r.clerk?.id === clerkId);
      setFieldCollectionData(myRecords);
      const today = new Date();
      const daily = myRecords.filter(
        (r) => new Date(r.timestamp).toDateString() === today.toDateString(),
      ).length;
      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() - today.getDay());
      const weekly = myRecords.filter(
        (r) => new Date(r.timestamp) >= weekStart,
      ).length;
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
      const monthly = myRecords.filter(
        (r) => new Date(r.timestamp) >= monthStart,
      ).length;
      dispatch(setCollectionRecords({ daily, weekly, monthly }));
    } catch (error) {
      ToastAndroid.show("Error fetching collections", ToastAndroid.SHORT);
    }
  }, [BusinessId, dispatch]);
  const getCarcasTypes = useCallback(async () => {
    try {
      const snapshot = await getDocs(
        collection(db, `Businesses/${BusinessId}/Products`),
      );
      const types = snapshot.docs.map((doc) => ({
        label: doc.data().name,
        value: doc.id,
      }));
      setCarcasTypesData(types);
      if (types.length > 0) setSelectedCarcasType(types[0]);
    } catch (error) {
      ToastAndroid.show("Error fetching carcas types", ToastAndroid.SHORT);
    }
  }, [BusinessId]);
  useEffect(() => {
    const load = async () => {
      await Promise.all([
        getProducts(),
        getLocations(),
        getClients(),
        getFieldCollections(),
        getCarcasTypes(),
      ]);
      await generateBatchCode();
    };
    load();
    const scale = store.getState().settings.scaleAddress;
    const printer = store.getState().settings.printerAddress;
    scale && RNBluetooth.connectToDevice(scale);
    printer && RNBluetooth.connectToDevice(printer);
  }, []);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    Promise.all([
      getProducts(),
      getLocations(),
      getClients(),
      getFieldCollections(),
      getCarcasTypes(),
      generateBatchCode(),
      loadStores(),
    ]).finally(() => setRefreshing(false));
  }, [getProducts, getLocations, getCarcasTypes, getClients, loadStores]);
  const handleNavigate = () => {
    const clientId = selectedClient?.value || "";
    const clientFullName = selectedClient?.label || "";
    const clientData = selectedClient?.clientData || {};
    const supplier = {
      id: clientId,
      name: clientFullName,
      fName: clientData.fName || "",
      lName: clientData.lName || "",
      phoneNumber: clientData.phoneNumber || "",
      location: clientData.location || "",
    };
    const destinationId = selectedDestination?.value || "";
    const destinationName = selectedDestination?.label || "";
    const carcasTypeId = selectedCarcasType?.value || "";
    const carcasTypeName = selectedCarcasType?.label || "";
    const navParams = {
      supplier,
      supplierId: clientId,
      supplierName: clientFullName,
      clientId,
      clientName: clientFullName,
      clientFirstName: clientData.fName || "",
      clientLastName: clientData.lName || "",
      clientPhone: clientData.phoneNumber || "",
      clientLocation: clientData.location || "",
      destinationId,
      destinationName,
      batchCode,
      carcasTypeId,
      carcasTypeName,
      tagId: "",
      ageMonths: 0,
    };
    setTimeout(() => generateBatchCode(), 100);
    navigation.navigate("RecordPage", navParams);
  };
  const boxTitles = [
    "Dry Goods         (Receiving Dry Goods)",
    "Carcasses     (Receiving Carcasses for Processing)",
  ];
  const [showCustomStoreScreen, setShowCustomStoreScreen] = useState(null);
  if (showDryGoodsScreen)
    return <DryGoodsScreen onClose={() => setShowDryGoodsScreen(false)} />;
  if (showCarcassesScreen)
    return <CarcassesScreen onClose={() => setShowCarcassesScreen(false)} />;
  if (showStorageScreen)
    return (
      <StorageScreen
        onClose={() => setShowStorageScreen(false)}
        onStoreCreated={loadStores}
      />
    );
  if (showButcheryScreen)
    return <ButcheryScreen onClose={() => setShowButcheryScreen(false)} />;
  if (showProcessingScreen)
    return <ProcessingScreen onClose={() => setShowProcessingScreen(false)} />;
  if (showPackingScreen)
    return <PackingScreen onClose={() => setShowPackingScreen(false)} />;
  if (showCustomStoreScreen)
    return (
      <GenericStoreScreen
        onClose={() => setShowCustomStoreScreen(null)}
        storeInfo={showCustomStoreScreen}
      />
    );
  const handleBoxPress = (title, storeInfo = null) => {
    if (title === boxTitles[0]) setShowDryGoodsScreen(true);
    else if (title === boxTitles[1]) setShowCarcassesScreen(true);
    else if (title === "Storage               (Manage Inventory)")
      setShowStorageScreen(true);
    else if (
      title === "Butchery                  (Weight Before/After Debonning)"
    )
      setShowButcheryScreen(true);
    else if (title === "Processing        (Process Debonned Meats)")
      setShowProcessingScreen(true);
    else if (title === "Packing                (Pack Processed Products)")
      setShowPackingScreen(true);
    else if (storeInfo) setShowCustomStoreScreen(storeInfo);
  };
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: "#F9F9F9" }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      <View style={styles.container}>
        <Header refresh={refreshing} handleClick={onRefresh} />
        <View style={styles.formContainer}>
          <View style={styles.batchCodeContainer}>
            <View style={styles.batchCodeLeft}>
              <Text style={styles.batchCodeLabel}>Batch Code:</Text>
              <Text
                style={styles.batchCodeValue}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {batchCode || "Generating..."}
              </Text>
            </View>
            <TouchableOpacity
              onPress={generateNewBatchCode}
              style={styles.refreshButton}
            >
              <Text style={styles.refreshText}>Refresh</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.gridContainer}>
            <TouchableOpacity
              style={styles.box}
              onPress={() => handleBoxPress(boxTitles[0])}
              activeOpacity={0.7}
            >
              <Text style={styles.boxText}>{boxTitles[0]}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.box}
              onPress={() => handleBoxPress(boxTitles[1])}
              activeOpacity={0.7}
            >
              <Text style={styles.boxText}>{boxTitles[1]}</Text>
            </TouchableOpacity>
            {customStoreScreens.map((store) => (
              <TouchableOpacity
                key={store.value}
                style={styles.box}
                onPress={() => handleBoxPress(store.label, store)}
                activeOpacity={0.7}
              >
                <Text style={styles.boxText}>
                  {store.label} (Receiving {store.label})
                </Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={styles.box}
              onPress={() => setShowStorageScreen(true)}
              activeOpacity={0.7}
            >
              <Text style={styles.boxText}>Storage (Manage Inventory)</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.box}
              onPress={() => setShowButcheryScreen(true)}
              activeOpacity={0.7}
            >
              <Text style={styles.boxText}>
                Butchery (Weight Before/After Debonning)
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.box}
              onPress={() => setShowProcessingScreen(true)}
              activeOpacity={0.7}
            >
              <Text style={styles.boxText}>
                Processing (Process Debonned Meats)
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.box}
              onPress={() => setShowPackingScreen(true)}
              activeOpacity={0.7}
            >
              <Text style={styles.boxText}>
                Packing (Pack Processed Products)
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.box}
              onPress={() => {}}
              activeOpacity={0.7}
            >
              <Text style={styles.boxText}>
                Sales (Weight of Sales Products)
              </Text>
            </TouchableOpacity>
          </View>
        </View>
        <TouchableOpacity
          onPress={handleNavigate}
          style={[styles.button, styles.button_Bg, styles.startButton]}
        >
          <Text style={styles.buttonText}>Start</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};

// ============ STYLES ============
const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 50,
    alignItems: "center",
    backgroundColor: "#F9F9F9",
    paddingHorizontal: screenWidth * 0.05,
  },
  formContainer: {
    marginTop: responsiveSize(30),
    gap: responsiveSize(15),
    width: "100%",
    alignItems: "center",
  },
  batchCodeContainer: {
    height: responsiveSize(50),
    borderRadius: responsiveSize(30),
    paddingHorizontal: responsiveSize(20),
    backgroundColor: "#F2F2F2",
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  batchCodeLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    marginRight: responsiveSize(60),
  },
  batchCodeLabel: {
    fontFamily: "Poppins-Medium",
    fontSize: responsiveSize(14),
    color: "#333",
    marginRight: responsiveSize(5),
  },
  batchCodeValue: {
    color: "#0066CC",
    fontFamily: "Poppins-SemiBold",
    fontSize: responsiveSize(14),
    flex: 1,
  },
  refreshButton: {
    position: "absolute",
    right: responsiveSize(15),
    paddingVertical: responsiveSize(5),
    paddingHorizontal: responsiveSize(10),
    backgroundColor: "#0066CC",
    borderRadius: responsiveSize(15),
  },
  refreshButtonSmall: {
    alignSelf: "flex-end",
    paddingVertical: responsiveSize(8),
    paddingHorizontal: responsiveSize(15),
    backgroundColor: "#0066CC",
    borderRadius: responsiveSize(8),
    marginBottom: responsiveSize(10),
  },
  refreshButtonSmallText: {
    color: "#FFFFFF",
    fontSize: responsiveSize(12),
    fontFamily: "Poppins-Medium",
  },
  refreshText: {
    color: "#FFFFFF",
    fontSize: responsiveSize(10),
    fontFamily: "Poppins-Medium",
  },
  searchInput: {
    height: responsiveSize(45),
    borderWidth: 1,
    borderColor: "#DDD",
    borderRadius: responsiveSize(8),
    paddingHorizontal: responsiveSize(15),
    marginBottom: responsiveSize(15),
    fontSize: responsiveSize(14),
    fontFamily: "Poppins-Regular",
    backgroundColor: "#FFF",
    width: "100%",
  },
  instructionText: {
    fontSize: responsiveSize(14),
    fontFamily: "Poppins-Regular",
    color: "#666",
    textAlign: "center",
    marginVertical: responsiveSize(10),
    fontStyle: "italic",
  },
  gridContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    width: "100%",
    marginTop: responsiveSize(10),
  },
  box: {
    width: "48%",
    backgroundColor: "#F2F2F2",
    borderRadius: responsiveSize(20),
    paddingVertical: responsiveSize(18),
    marginBottom: responsiveSize(12),
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  boxText: {
    fontFamily: "Poppins-Medium",
    fontSize: responsiveSize(16),
    color: "#333",
    textAlign: "center",
    paddingHorizontal: responsiveSize(8),
    flexWrap: "wrap",
  },
  button: {
    height: responsiveSize(50),
    borderRadius: responsiveSize(30),
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
  },
  button_Bg: { backgroundColor: "#F2F2F2" },
  startButton: { marginTop: responsiveSize(30) },
  buttonText: { fontSize: responsiveSize(16), fontFamily: "Poppins-Medium" },
  dryGoodsContainer: {
    flex: 1,
    backgroundColor: "#F9F9F9",
    paddingHorizontal: screenWidth * 0.05,
    paddingTop: 20,
  },
  backButton: {
    alignSelf: "flex-start",
    marginBottom: responsiveSize(20),
    padding: responsiveSize(10),
  },
  backButtonText: {
    fontSize: responsiveSize(18),
    fontFamily: "Poppins-Medium",
    color: "#0066CC",
  },
  dryGoodsTitle: {
    fontSize: responsiveSize(24),
    fontFamily: "Poppins-Bold",
    color: "#333",
    textAlign: "center",
    marginBottom: responsiveSize(30),
  },
  inputField: {
    height: responsiveSize(50),
    borderWidth: 1,
    borderColor: "#DDD",
    borderRadius: responsiveSize(10),
    paddingHorizontal: responsiveSize(15),
    marginBottom: responsiveSize(15),
    fontSize: responsiveSize(16),
    fontFamily: "Poppins-Regular",
    backgroundColor: "#FFF",
    width: "100%",
  },
  display: {
    height: 100,
    width: "100%",
    borderRadius: 10,
    flexDirection: "row",
    padding: 10,
    justifyContent: "space-between",
    alignItems: "center",
    marginVertical: 10,
  },
  data: { flex: 1 },
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
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginVertical: 10,
    width: "100%",
  },
  summaryBox: {
    flex: 1,
    backgroundColor: "#F0F0F0",
    padding: responsiveSize(15),
    borderRadius: 10,
  },
  summaryText: {
    fontSize: responsiveSize(16),
    fontFamily: "Poppins-Medium",
    color: "#333",
    textAlign: "center",
  },
  resetButton: {
    backgroundColor: "#FFA500",
    paddingVertical: responsiveSize(10),
    paddingHorizontal: responsiveSize(15),
    borderRadius: responsiveSize(8),
    marginLeft: responsiveSize(10),
  },
  resetButtonText: {
    color: "#FFF",
    fontFamily: "Poppins-Medium",
    fontSize: responsiveSize(14),
  },
  captureButton: {
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    marginVertical: 10,
    width: "100%",
  },
  captureButtonText: {
    fontFamily: "Poppins-SemiBold",
    fontSize: 18,
    color: "white",
  },
  sectionHeader: {
    fontSize: 18,
    fontFamily: "Poppins-Bold",
    marginTop: 20,
    marginBottom: 10,
    color: "#333",
    width: "100%",
  },
  captureItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#FFF",
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#EEE",
    width: "100%",
  },
  captureDetails: { flex: 1 },
  captureText: { fontSize: 16, fontFamily: "Poppins-Medium", color: "#333" },
  captureDate: {
    fontSize: 12,
    fontFamily: "Poppins-Regular",
    color: "#999",
    marginTop: 4,
  },
  deleteButton: {
    backgroundColor: "#FF4444",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  deleteButtonText: {
    color: "#FFF",
    fontSize: 12,
    fontFamily: "Poppins-Medium",
  },
  saveButton: {
    backgroundColor: "#0066CC",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 20,
    marginBottom: 30,
    width: "100%",
  },
  saveButtonText: {
    color: "#FFF",
    fontSize: 18,
    fontFamily: "Poppins-SemiBold",
  },
  recordsHeader: {
    fontSize: 20,
    fontFamily: "Poppins-Bold",
    marginBottom: 15,
    color: "#333",
    width: "100%",
  },
  sessionItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    backgroundColor: "#FFF",
    padding: 12,
    borderRadius: 8,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#EEE",
    width: "100%",
  },
  sessionDetails: { flex: 1 },
  sessionType: { fontSize: 16, fontFamily: "Poppins-Bold", color: "#333" },
  sessionInfo: {
    fontSize: 12,
    fontFamily: "Poppins-Regular",
    color: "#666",
    marginTop: 2,
  },
  sessionStore: {
    fontSize: 11,
    fontFamily: "Poppins-Regular",
    color: "#0066CC",
    marginTop: 2,
  },
  sessionCaptureSummary: {
    fontSize: 11,
    fontFamily: "Poppins-Regular",
    color: "#999",
    marginTop: 2,
  },
  emptyText: {
    textAlign: "center",
    color: "#999",
    fontSize: 14,
    fontFamily: "Poppins-Regular",
    marginTop: 20,
  },
  storageContainer: {
    flex: 1,
    backgroundColor: "#F9F9F9",
    padding: responsiveSize(20),
  },
  storageTitle: {
    fontSize: responsiveSize(24),
    fontFamily: "Poppins-Bold",
    color: "#333",
    textAlign: "center",
    marginBottom: responsiveSize(30),
  },
  storageOption: {
    backgroundColor: "#0066CC",
    paddingVertical: responsiveSize(15),
    borderRadius: responsiveSize(10),
    marginVertical: responsiveSize(10),
    alignItems: "center",
  },
  storageOptionText: {
    color: "#FFF",
    fontSize: responsiveSize(18),
    fontFamily: "Poppins-Medium",
  },
  stockItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#FFF",
    padding: 12,
    borderRadius: 8,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#EEE",
  },
  stockDetails: { flex: 1 },
  stockType: { fontSize: 16, fontFamily: "Poppins-Bold", color: "#333" },
  stockInfo: {
    fontSize: 14,
    fontFamily: "Poppins-Regular",
    color: "#666",
    marginTop: 4,
  },
  stockDate: {
    fontSize: 12,
    fontFamily: "Poppins-Regular",
    color: "#999",
    marginTop: 4,
  },
  removeButton: {
    backgroundColor: "#FF4444",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  removeButtonText: {
    color: "#FFF",
    fontSize: 12,
    fontFamily: "Poppins-Medium",
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  modalContent: {
    backgroundColor: "#FFF",
    borderRadius: 10,
    padding: 20,
    width: "80%",
  },
  modalTitle: {
    fontSize: 20,
    fontFamily: "Poppins-Bold",
    marginBottom: 10,
    textAlign: "center",
  },
  modalSubtitle: {
    fontSize: 16,
    fontFamily: "Poppins-Medium",
    marginBottom: 5,
  },
  modalButtons: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 20,
  },
  modalButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 6,
    marginHorizontal: 5,
    alignItems: "center",
  },
  modalButtonText: {
    color: "#FFF",
    fontSize: 14,
    fontFamily: "Poppins-Medium",
  },
  deletedRecordItem: {
    backgroundColor: "#FFF",
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#FFCCCC",
    width: "100%",
  },
  deletedRecordDetails: { flex: 2 },
  deletedRecordType: {
    fontSize: 16,
    fontFamily: "Poppins-Bold",
    color: "#CC0000",
  },
  deletedRecordInfo: {
    fontSize: 14,
    fontFamily: "Poppins-Regular",
    color: "#666",
    marginTop: 4,
  },
  deletedRecordReason: {
    fontSize: 14,
    fontFamily: "Poppins-Regular",
    color: "#666",
    marginTop: 4,
  },
  deletedRecordDate: {
    fontSize: 12,
    fontFamily: "Poppins-Regular",
    color: "#999",
    marginTop: 4,
  },
  recipeSection: {
    marginBottom: 20,
    padding: 10,
    backgroundColor: "#FFF",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#DDD",
  },
  recipeHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
  },
  divider: { height: 2, backgroundColor: "#DDD", marginVertical: 20 },
  recipeSummary: {
    backgroundColor: "#F5F5F5",
    padding: 15,
    borderRadius: 10,
    marginVertical: 10,
  },
});

export default HomePage;

// Importing necessary modules and components from React, React Native, and other libraries
/*import React, { useEffect, useState, useCallback } from "react";
import {
  Text,
  StyleSheet,
  View,
  Dimensions,
  RefreshControl,
  TouchableOpacity,
  ScrollView,
  ToastAndroid,
} from "react-native";
import DropdownComponent from "../Components/DropDown"; // Custom dropdown component
import Header from "../Components/Header"; // Custom header component
import { useNavigation } from "@react-navigation/native"; // Navigation hook for navigating between screens
import { store } from "../store/store"; // Redux store
import { setCollectionRecords, setLocations, setProducts } from "../store"; // Redux actions
import { useDispatch } from "react-redux"; // Redux hook for dispatching actions
import { collection, getDocs } from "firebase/firestore"; // Firestore methods for database operations
import { db } from "../Database/config"; // Firestore database configuration
import { useBluetooth } from "rn-bluetooth-classic"; // Custom Bluetooth hook
import RNBluetooth from "react-native-bluetooth-classic"; // Bluetooth library

// Getting the width of the device's screen
const screenWidth = Dimensions.get("window").width;

// Defining the HomePage component
const HomePage = () => {
  const dispatch = useDispatch(); // Getting the dispatch function from Redux
  const navigation = useNavigation(); // Getting the navigation function from React Navigation
  const [refreshing, setRefreshing] = useState(false); // State to handle pull-to-refresh functionality
  const [selectedProduct, setSelectedProduct] = useState(null); // State to manage selected product from dropdown
  const [selectedLocation, setSelectedLocation] = useState(null); // State to manage selected location from dropdown
  const [productsData, setProductsData] = useState([]); // State to store products data
  const [locationsData, setLocationsData] = useState([]); // State to store locations data
  const [fieldCollectionData, setFieldCollectionData] = useState([]); // State to store field collection data
  const { connectToDevice } = useBluetooth(); // Destructuring Bluetooth connect function

  // Fetching the BusinessId from the Redux store
  const BusinessId = store.getState().settings.BusinessId;

  // Function to fetch products from Firestore database
  const getProducts = useCallback(async () => {
    try {
      const productsCollection = collection(
        db,
        `Businesses/${BusinessId}/Products`
      ); // Defining the collection path in Firestore
      const productsSnapshot = await getDocs(productsCollection); // Fetching the documents from the collection
      const products = productsSnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })); // Mapping the documents to an array of product objects

      // Getting stored products from Redux store
      const storedProducts = store.getState().settings.products;
      let mergedProducts;

      // Merging the fetched products with stored products to avoid duplication
      if (Array.isArray(storedProducts)) {
        const newProducts = products.filter(
          (product) => !storedProducts.some((p) => p.id === product.id)
        );
        mergedProducts = [...storedProducts, ...newProducts];
      } else {
        mergedProducts = products;
      }

      dispatch(setProducts(mergedProducts)); // Dispatching the merged products to Redux store

      // Setting the products data for the dropdown component
      setProductsData(
        mergedProducts.map((product) => ({
          isDukawala: product.isDukawala,
          price: product.price,
          label: product.name,
          value: product.id,
        }))
      );
    } catch (error) {
      console.error("Error fetching products:", error); // Logging error if fetching products fails
      ToastAndroid.show("Error fetching products", ToastAndroid.SHORT); // Showing a toast message on error
    }
  }, [BusinessId, dispatch]); // Dependency array for the useCallback hook

  // Function to fetch locations from Firestore database
  const getLocations = useCallback(async () => {
    try {
      const locationsCollection = collection(
        db,
        `Businesses/${BusinessId}/Locations`
      ); // Defining the collection path in Firestore
      const locationsSnapshot = await getDocs(locationsCollection); // Fetching the documents from the collection
      const locations = locationsSnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })); // Mapping the documents to an array of location objects

      // Getting stored locations from Redux store
      const storedLocations = store.getState().settings.locations;
      let mergedLocations;

      // Merging the fetched locations with stored locations to avoid duplication
      if (Array.isArray(storedLocations)) {
        const newLocations = locations.filter(
          (location) => !storedLocations.some((l) => l.id === location.id)
        );
        mergedLocations = [...storedLocations, ...newLocations];
      } else {
        mergedLocations = locations;
      }

      dispatch(setLocations(mergedLocations)); // Dispatching the merged locations to Redux store

      // Setting the locations data for the dropdown component
      setLocationsData(
        mergedLocations.map((location) => ({
          label: location.name,
          value: location.id,
        }))
      );
    } catch (error) {
      console.error("Error fetching locations:", error); // Logging error if fetching locations fails
      ToastAndroid.show("Error fetching locations", ToastAndroid.SHORT); // Showing a toast message on error
    }
  }, [BusinessId, dispatch]); // Dependency array for the useCallback hook

  const getFieldCollections = useCallback(async () => {
    try {
      const fieldCollectionCollection = collection(
        db,
        `Businesses/${BusinessId}/FieldCollections`
      ); // Defining the collection path in Firestore
      const fieldCollectionSnapshot = await getDocs(fieldCollectionCollection); // Fetching the documents from the collection
      const fieldCollections = fieldCollectionSnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })); // Mapping the documents to an array of field collection objects

      const clerkId = store.getState().settings.user.clerkId;
      // Setting the field collection data for the dropdown component
      setFieldCollectionData(fieldCollections.filter((fieldCollection) => fieldCollection.clerk.id === clerkId));

      const dailyRecords = fieldCollectionData.filter((fieldCollection) => {
        const today = new Date();
        const recordDate = new Date(fieldCollection.timestamp);
        return (
          recordDate.getFullYear() === today.getFullYear() &&
          recordDate.getMonth() === today.getMonth() &&
          recordDate.getDate() === today.getDate()
        );
      });

      const weeklyRecords = fieldCollectionData.filter((fieldCollection) => {
        const today = new Date();
        const firstDayOfWeek = today.getDate() - today.getDay();
        const weekStart = new Date(today.setDate(firstDayOfWeek));
        weekStart.setHours(0, 0, 0, 0);

        const recordDate = new Date(fieldCollection.timestamp);
        return recordDate >= weekStart;
      });

      const monthlyRecords = fieldCollectionData.filter((fieldCollection) => {
        const today = new Date();
        const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
        monthStart.setHours(0, 0, 0, 0);

        const recordDate = new Date(fieldCollection.timestamp);
        return recordDate >= monthStart;
      });
      const initialCollectionRecords = store.getState().settings.collectionRecords;
      const collectionRecords = {
        daily: dailyRecords.length,
        weekly: weeklyRecords.length,
        monthly: monthlyRecords.length,
      };
      dispatch(setCollectionRecords(collectionRecords));
    } catch (error) {
      ToastAndroid.show("Error fetching field collections", ToastAndroid.SHORT); // Showing a toast message on error
    }
  });

  


  // useEffect hook to fetch data and connect to Bluetooth devices on component mount
  useEffect(() => {
    const fetchData = async () => {
      await getProducts(); // Fetching products data
      await getLocations(); // Fetching locations data
      await getFieldCollections(); // Fetching field collections data
    };

    // Getting the scale and printer addresses from the Redux store
    const scale = store.getState().settings.scaleAddress;
    const printer = store.getState().settings.printerAddress;

    // Connecting to Bluetooth devices if addresses are available
    scale && RNBluetooth.connectToDevice(scale);
    printer && RNBluetooth.connectToDevice(printer);

    fetchData(); // Fetching data
  }, [getProducts, getLocations]); // Dependency array for the useEffect hook

  // Function to handle pull-to-refresh functionality
  const onRefresh = useCallback(() => {
    setRefreshing(true); // Setting the refreshing state to true
    Promise.all([getProducts(), getLocations(), getFieldCollections()]).finally(() => {
      setRefreshing(false); // Setting the refreshing state to false after fetching data
    });
  }, [getProducts, getLocations]); // Dependency array for the useCallback hook

  // Function to handle navigation to the RecordPage screen
  const handleNavigate = () => {
    if (!selectedProduct) {
      ToastAndroid.show("Please select a product", ToastAndroid.SHORT); // Showing a toast message if no product is selected
      return;
    }

    if (!selectedLocation) {
      ToastAndroid.show("Please select a location", ToastAndroid.SHORT); // Showing a toast message if no location is selected
      return;
    }

    // Navigating to the RecordPage screen with selected product and location
    navigation.navigate("RecordPage", {
      productsData: productsData,
      product: selectedProduct,
      location: selectedLocation,
    });
  };

  const handleScaleBt = async () => {
    const scale = store.getState().settings.scaleAddress;
    connectToDevice(scale);
    console.log("Scale: ", scale);
  };


  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: "#F9F9F9" }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} /> // Adding pull-to-refresh control
      }
    >
      <View style={styles.container}>
        <Header refresh={refreshing} handleClick={onRefresh} />
        <View style={styles.recordSection}>
          <Text style={styles.heading}>Total Records</Text>
          <Text style={styles.normalText}>
            Today: {store.getState().settings.collectionRecords ? store.getState().settings.collectionRecords.daily : 0}
          </Text>
          <Text style={styles.normalText}>
           This Week: {store.getState().settings.collectionRecords ? store.getState().settings.collectionRecords.weekly : 0}
          </Text>
          <Text style={styles.normalText}>
            This Month: {store.getState().settings.collectionRecords ? store.getState().settings.collectionRecords.monthly : 0}
          </Text>
        </View>
        <View style={{ marginTop: 30, gap: 5, flex: 1 }}>
          <DropdownComponent
            title={"Products"}
            onChange={(value) => {
              setSelectedProduct(value); // Setting the selected product state
            }}
            data={productsData} // Providing products data to the dropdown component
          />
          <DropdownComponent
            title={"Location"}
            onChange={(value) => {
              console.log(value.label);
              setSelectedLocation(value); // Setting the selected location state
            }}
            data={locationsData} // Providing locations data to the dropdown component
          />
        </View>
        <TouchableOpacity
          onPress={handleNavigate}
          style={[styles.button, styles.button_Bg, { marginTop: 30 }]}
        >
          <Text style={styles.buttonText}>Start</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleScaleBt}
          style={[styles.button, styles.button_Bg, { marginTop: 30 }]}
        >
          <Text style={styles.buttonText}>Connect to Scale</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};

// Defining the styles for the components
const styles = StyleSheet.create({
  container: {
    flex: 1,
    display: "flex",
    backgroundColor: "#F9F9F9",
    paddingVertical: 10,
    paddingTop: 50,
    alignItems: "center",
  },
  heading: {
    fontSize: 20,
    fontFamily: "Poppins-Regular",
  },
  normalText: {
    fontSize: 16,
    fontFamily: "Poppins-Regular",
  },
  buttonText: {
    fontSize: 16,
    fontFamily: "Poppins-Medium",
  },
  recordSection: {
    display: "flex",
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: "#F2F2F2",
    width: screenWidth * 0.9,
    marginTop: 20,
  },
  button: {
    height: 50,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
    width: screenWidth * 0.9,
  },
  button_Bg: {
    backgroundColor: "#F2F2F2",
  },
});

// export default HomePage; // Exporting the HomePage component as the default export*/
