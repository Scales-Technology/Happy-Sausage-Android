import React, { useEffect, useState, useCallback, useRef } from "react";
import { useSelector } from "react-redux";
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
  ActivityIndicator,
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
const DISPATCH_RECORDS_KEY = "@dispatch_records";
const USED_STOCK_KEY = "@used_stock_records";
const WEIGHT_BEFORE_DEBONNING_KEY = "@weight_before_debonning_records";
const RETURNED_RECORDS_KEY = "@returned_stock_records";

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

// Generate unique ID for each packed item
const generatePackId = (type, index) => {
  return `${type}-${String(index).padStart(5, "0")}`;
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
      onClose();
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

// ============ CREATE RECIPE MODAL ============
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
  const [filteredDryGoods, setFilteredDryGoods] = useState(dryGoodsItems);
  const [filteredCarcass, setFilteredCarcass] = useState(carcassItems);
  const [amountModalVisible, setAmountModalVisible] = useState(false);
  const [selectedIngredientType, setSelectedIngredientType] = useState(null);
  const [selectedIngredientItem, setSelectedIngredientItem] = useState(null);
  const [pieceWeight, setPieceWeight] = useState(0);
  const [weightMismatchModalVisible, setWeightMismatchModalVisible] =
    useState(false);
  const [mismatchData, setMismatchData] = useState(null);
  const [isProcessingSave, setIsProcessingSave] = useState(false);

  useEffect(() => {
    if (!visible) {
      setRecipeName("");
      setPackSize("");
      setPiecesPerPack("");
      setRecipeItems([]);
      setDryGoodsSearchText("");
      setCarcassSearchText("");
      setPieceWeight(0);
      setWeightMismatchModalVisible(false);
      setMismatchData(null);
      setIsProcessingSave(false);
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
      (i) => i.type === type && i.itemId === item.value,
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
          itemId: item.value,
          itemName: item.label,
          amountPerPiece: amount,
        },
      ]);
      ToastAndroid.show(`Added ${item.label}`, ToastAndroid.SHORT);
    }
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
    const calculatedPackWeightGrams = calculatedPackWeight * 1000;

    if (Math.abs(calculatedPackWeightGrams - packSizeNum) > 1) {
      setMismatchData({
        packSizeEntered: packSizeNum,
        calculatedPackWeight: calculatedPackWeightGrams,
        pieceWeight: pieceWeightNum,
        piecesPerPack: piecesPerPackNum,
        difference: Math.abs(calculatedPackWeightGrams - packSizeNum),
        isOverweight: calculatedPackWeightGrams > packSizeNum,
        ingredientCount: recipeItems.length,
        ingredientSummary: recipeItems.map((i) => ({
          name: i.itemName,
          amount: i.amountPerPiece * 1000,
        })),
      });
      setWeightMismatchModalVisible(true);
      return;
    }

    saveRecipeData();
  };

  const saveRecipeData = () => {
    setIsProcessingSave(true);
    const packSizeNum = parseFloat(packSize);
    const piecesPerPackNum = parseInt(piecesPerPack);
    try {
      onSave(
        recipeName.trim(),
        recipeItems,
        packSizeNum,
        piecesPerPackNum,
        pieceWeight,
      );
      setWeightMismatchModalVisible(false);
      setMismatchData(null);
      setIsProcessingSave(false);
      onClose();
    } catch (error) {
      setIsProcessingSave(false);
      ToastAndroid.show("Error saving recipe", ToastAndroid.SHORT);
    }
  };

  const renderDryGoodsItem = ({ item }) => (
    <View style={styles.stockItem}>
      <View style={styles.stockDetails}>
        <Text style={styles.stockType}>{item.displayName || item.label}</Text>
        {item.description && (
          <Text style={styles.stockInfo}>Description: {item.description}</Text>
        )}
        {item.unit && <Text style={styles.stockInfo}>Unit: {item.unit}</Text>}
        <Text style={styles.stockInfo}>
          Available: {item.totalWeight?.toFixed(3) || "0.000"} kg
        </Text>
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
          {item.type === "dry" ? "Dry Good" : "Carcass"}
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

  const WeightMismatchModal = () => {
    if (!mismatchData) return null;

    const {
      packSizeEntered,
      calculatedPackWeight,
      pieceWeight,
      piecesPerPack,
      difference,
      isOverweight,
      ingredientSummary,
    } = mismatchData;

    const correctionFactor = packSizeEntered / calculatedPackWeight;
    const correctedPieceWeight = pieceWeight * correctionFactor;

    return (
      <Modal
        animationType="slide"
        transparent={true}
        visible={weightMismatchModalVisible}
        onRequestClose={() => setWeightMismatchModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <ScrollView
            style={{ maxHeight: "90%" }}
            showsVerticalScrollIndicator={false}
          >
            <View
              style={[
                styles.modalContent,
                { width: "90%", backgroundColor: "#1a1a2e" },
              ]}
            >
              <Text
                style={[styles.modalTitle, { color: "#FF4444", fontSize: 20 }]}
              >
                ⚠️ Weight Mismatch Detected!
              </Text>

              <View
                style={{
                  borderBottomWidth: 1,
                  borderColor: "#2a2a4a",
                  marginVertical: 10,
                }}
              />

              <Text
                style={[
                  styles.modalSubtitle,
                  { color: "#fff", fontWeight: "bold" },
                ]}
              >
                📊 Current Calculation:
              </Text>
              <Text
                style={[styles.modalSubtitle, { color: "#aaa", marginLeft: 8 }]}
              >
                • Total ingredients per piece: {(pieceWeight * 1000).toFixed(1)}
                g
              </Text>
              <Text
                style={[styles.modalSubtitle, { color: "#aaa", marginLeft: 8 }]}
              >
                • Pieces per pack: {piecesPerPack}
              </Text>
              <Text
                style={[
                  styles.modalSubtitle,
                  { color: "#FFA500", marginLeft: 8 },
                ]}
              >
                • Calculated pack weight: {calculatedPackWeight.toFixed(1)}g
              </Text>
              <Text
                style={[
                  styles.modalSubtitle,
                  { color: "#4CAF50", marginLeft: 8 },
                ]}
              >
                • You entered: {packSizeEntered}g
              </Text>
              <Text
                style={[
                  styles.modalSubtitle,
                  { color: "#FF4444", marginLeft: 8, fontWeight: "bold" },
                ]}
              >
                • Difference: {difference.toFixed(1)}g (
                {isOverweight ? "OVER" : "UNDER"} by {difference.toFixed(1)}g)
              </Text>

              <View
                style={{
                  borderBottomWidth: 1,
                  borderColor: "#2a2a4a",
                  marginVertical: 10,
                }}
              />

              <Text
                style={[
                  styles.modalSubtitle,
                  { color: "#fff", fontWeight: "bold" },
                ]}
              >
                📝 Ingredients Breakdown:
              </Text>
              {ingredientSummary.map((item, idx) => (
                <Text
                  key={idx}
                  style={[
                    styles.modalSubtitle,
                    { color: "#aaa", marginLeft: 8 },
                  ]}
                >
                  • {item.name}: {item.amount.toFixed(1)}g
                </Text>
              ))}

              <View
                style={{
                  borderBottomWidth: 1,
                  borderColor: "#2a2a4a",
                  marginVertical: 10,
                }}
              />

              <Text
                style={[
                  styles.modalSubtitle,
                  { color: "#4CAF50", fontWeight: "bold" },
                ]}
              >
                💡 How to Fix:
              </Text>

              <View
                style={{
                  backgroundColor: "#0a0a1a",
                  borderRadius: 8,
                  padding: 12,
                  marginTop: 8,
                }}
              >
                <Text
                  style={[
                    styles.modalSubtitle,
                    { color: "#FFA500", fontWeight: "bold" },
                  ]}
                >
                  Option 1: Increase Pack Size
                </Text>
                <Text
                  style={[
                    styles.modalSubtitle,
                    { color: "#aaa", marginLeft: 8 },
                  ]}
                >
                  Change pack size to: {calculatedPackWeight.toFixed(0)}g
                </Text>
              </View>

              <View
                style={{
                  backgroundColor: "#0a0a1a",
                  borderRadius: 8,
                  padding: 12,
                  marginTop: 8,
                }}
              >
                <Text
                  style={[
                    styles.modalSubtitle,
                    { color: "#FFA500", fontWeight: "bold" },
                  ]}
                >
                  Option 2: Reduce Ingredients Proportionally
                </Text>
                <Text
                  style={[
                    styles.modalSubtitle,
                    { color: "#aaa", marginLeft: 8 },
                  ]}
                >
                  Multiply each ingredient by: {correctionFactor.toFixed(3)}
                </Text>
                <Text
                  style={[
                    styles.modalSubtitle,
                    { color: "#aaa", marginLeft: 8 },
                  ]}
                >
                  New piece weight: {correctedPieceWeight.toFixed(4)}kg (
                  {correctedPieceWeight * 1000}g)
                </Text>
                <Text
                  style={[
                    styles.modalSubtitle,
                    {
                      color: "#aaa",
                      marginLeft: 8,
                      fontSize: 10,
                      fontStyle: "italic",
                    },
                  ]}
                >
                  Formula: Entered Pack Size ÷ Calculated Pack Weight ={" "}
                  {packSizeEntered} ÷ {calculatedPackWeight.toFixed(1)} ={" "}
                  {correctionFactor.toFixed(3)}
                </Text>
              </View>

              <View
                style={{
                  backgroundColor: "#0a0a1a",
                  borderRadius: 8,
                  padding: 12,
                  marginTop: 8,
                }}
              >
                <Text
                  style={[
                    styles.modalSubtitle,
                    { color: "#FFA500", fontWeight: "bold" },
                  ]}
                >
                  📐 Simple Example:
                </Text>
                <Text
                  style={[
                    styles.modalSubtitle,
                    { color: "#aaa", marginLeft: 8 },
                  ]}
                >
                  For a 250g sausage with 2 ingredients:
                </Text>
                <Text
                  style={[
                    styles.modalSubtitle,
                    { color: "#aaa", marginLeft: 8 },
                  ]}
                >
                  • Meat: 200g (0.200kg)
                </Text>
                <Text
                  style={[
                    styles.modalSubtitle,
                    { color: "#aaa", marginLeft: 8 },
                  ]}
                >
                  • Salt: 50g (0.050kg)
                </Text>
                <Text
                  style={[
                    styles.modalSubtitle,
                    { color: "#4CAF50", marginLeft: 8 },
                  ]}
                >
                  ✅ Total: 250g ✅ MATCHES pack size!
                </Text>
              </View>

              <View
                style={{
                  borderBottomWidth: 1,
                  borderColor: "#2a2a4a",
                  marginVertical: 10,
                }}
              />

              <Text
                style={[
                  styles.modalSubtitle,
                  { color: "#FF4444", textAlign: "center", fontSize: 12 },
                ]}
              >
                ⚠️ You CANNOT continue with this mismatch.
              </Text>
              <Text
                style={[
                  styles.modalSubtitle,
                  { color: "#aaa", textAlign: "center", fontSize: 11 },
                ]}
              >
                Please fix your recipe first using the options above.
              </Text>

              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={[
                    styles.modalButton,
                    { backgroundColor: "#FF4444", opacity: 0.5 },
                  ]}
                  disabled={true}
                >
                  <Text style={[styles.modalButtonText, { color: "#888" }]}>
                    ❌ Continue (Disabled)
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalButton, { backgroundColor: "#4CAF50" }]}
                  onPress={() => {
                    setWeightMismatchModalVisible(false);
                    setMismatchData(null);
                  }}
                >
                  <Text style={styles.modalButtonText}>✏️ Fix Recipe</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>
    );
  };

  return (
    <>
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
                    {(pieceWeight * (parseInt(piecesPerPack) || 0)).toFixed(6)}{" "}
                    kg
                  </Text>
                </View>
              )}

              <Text style={styles.sectionHeader}>
                Select Dry Goods (in stock)
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
                  <Text style={styles.emptyText}>
                    No dry goods available in stock
                  </Text>
                }
                scrollEnabled={false}
                keyboardShouldPersistTaps="handled"
              />

              <Text style={styles.sectionHeader}>
                Select Carcass (in stock)
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
                  <Text style={styles.emptyText}>
                    No carcass available in stock
                  </Text>
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

              <TouchableOpacity
                style={styles.saveButton}
                onPress={handleSave}
                disabled={isProcessingSave}
              >
                <Text style={styles.saveButtonText}>
                  {isProcessingSave ? "Saving..." : "Save Recipe"}
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
        <AddAmountModal
          visible={amountModalVisible}
          item={selectedIngredientItem}
          onAdd={(amount) =>
            addIngredient(
              selectedIngredientType,
              selectedIngredientItem,
              amount,
            )
          }
          onClose={() => {
            setAmountModalVisible(false);
            setSelectedIngredientItem(null);
          }}
        />
      </Modal>
      <WeightMismatchModal />
    </>
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

// ============ PACKING SCREEN ============
const PackingScreen = ({ onClose }) => {
  const [activeTab, setActiveTab] = useState("sausage");
  const [sausageProcessingBatches, setSausageProcessingBatches] = useState([]);
  const [debonnedMeatItems, setDebonnedMeatItems] = useState([]);
  const [filteredSausage, setFilteredSausage] = useState([]);
  const [filteredMeat, setFilteredMeat] = useState([]);
  const [searchText, setSearchText] = useState("");
  const [selectedItem, setSelectedItem] = useState(null);
  const [piecesToPack, setPiecesToPack] = useState("");
  const [packingRecords, setPackingRecords] = useState([]);
  const [filteredRecords, setFilteredRecords] = useState([]);
  const [recordsSearchText, setRecordsSearchText] = useState("");
  const [packedProducts, setPackedProducts] = useState([]);
  const [groupedInventory, setGroupedInventory] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [packCounter, setPackCounter] = useState(1);
  const [meatPackCounter, setMeatPackCounter] = useState(1);
  const [isProcessing, setIsProcessing] = useState(false);

  const [meatConfigModalVisible, setMeatConfigModalVisible] = useState(false);
  const [selectedDebonnedItem, setSelectedDebonnedItem] = useState(null);
  const [meatType, setMeatType] = useState("");
  const [kgToPack, setKgToPack] = useState("");
  const [packSizeGrams, setPackSizeGrams] = useState("");
  const [piecesPerPack, setPiecesPerPack] = useState("");

  const [calculatedPieces, setCalculatedPieces] = useState(0);
  const [calculatedPacks, setCalculatedPacks] = useState(0);
  const [remainingWeightAfterPack, setRemainingWeightAfterPack] = useState(0);

  useEffect(() => {
    loadSausageBatches();
    loadDebonnedMeat();
    loadPackingRecords();
    loadPackedProducts();
    loadPackCounter();
    loadMeatPackCounter();
  }, []);

  useEffect(() => {
    groupInventory(packedProducts);
  }, [packedProducts]);

  useEffect(() => {
    if (searchText.trim() === "") {
      setFilteredSausage(sausageProcessingBatches);
      setFilteredMeat(debonnedMeatItems);
    } else {
      setFilteredSausage(
        sausageProcessingBatches.filter(
          (batch) =>
            batch.productName
              ?.toLowerCase()
              .includes(searchText.toLowerCase()) ||
            batch.batchCode?.toLowerCase().includes(searchText.toLowerCase()),
        ),
      );
      setFilteredMeat(
        debonnedMeatItems.filter(
          (item) =>
            item.type?.toLowerCase().includes(searchText.toLowerCase()) ||
            item.batchCode?.toLowerCase().includes(searchText.toLowerCase()),
        ),
      );
    }
  }, [searchText, sausageProcessingBatches, debonnedMeatItems]);

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

  useEffect(() => {
    if (
      selectedDebonnedItem &&
      kgToPack &&
      parseFloat(kgToPack) > 0 &&
      packSizeGrams &&
      parseFloat(packSizeGrams) > 0
    ) {
      const kgToPackNum = parseFloat(kgToPack);
      const packSizeKg = parseFloat(packSizeGrams) / 1000;
      const piecesPerPackNum = parseInt(piecesPerPack) || 1;

      const totalPiecesPossible = Math.floor(kgToPackNum / packSizeKg);
      setCalculatedPieces(totalPiecesPossible);

      const packsPossible = Math.floor(totalPiecesPossible / piecesPerPackNum);
      setCalculatedPacks(packsPossible);

      const newRemainingWeight =
        selectedDebonnedItem.currentWeight - kgToPackNum;
      setRemainingWeightAfterPack(newRemainingWeight);
    } else {
      setCalculatedPieces(0);
      setCalculatedPacks(0);
      if (selectedDebonnedItem && kgToPack) {
        setRemainingWeightAfterPack(
          selectedDebonnedItem.currentWeight - parseFloat(kgToPack),
        );
      } else if (selectedDebonnedItem) {
        setRemainingWeightAfterPack(selectedDebonnedItem.currentWeight);
      } else {
        setRemainingWeightAfterPack(0);
      }
    }
  }, [kgToPack, packSizeGrams, piecesPerPack, selectedDebonnedItem]);

  const groupInventory = (products) => {
    const grouped = {};
    products.forEach((product) => {
      if (product.status === "In Stock") {
        const key = `${product.productName}-${product.packSize}g`;
        if (!grouped[key]) {
          grouped[key] = {
            id: key,
            productName: product.productName,
            packSize: product.packSize,
            piecesPerPack: product.piecesPerPack,
            totalPacks: 0,
            totalWeight: 0,
            packBatchNumbers: [],
          };
        }
        grouped[key].totalPacks++;
        grouped[key].totalWeight += product.totalWeight || 0;
        grouped[key].packBatchNumbers.push(product.packBatchNumber);
      }
    });
    setGroupedInventory(Object.values(grouped));
  };

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

  const loadMeatPackCounter = async () => {
    try {
      const stored = await AsyncStorage.getItem("@meat_pack_counter");
      if (stored) setMeatPackCounter(parseInt(stored));
    } catch (error) {
      console.error("Failed to load meat pack counter", error);
    }
  };

  const saveMeatPackCounter = async (counter) => {
    try {
      await AsyncStorage.setItem("@meat_pack_counter", counter.toString());
    } catch (error) {
      console.error("Failed to save meat pack counter", error);
    }
  };

  const loadSausageBatches = async () => {
    try {
      const stored = await AsyncStorage.getItem(PROCESSING_RECORDS_KEY);
      if (stored) {
        let batches = JSON.parse(stored);
        const sausage = batches.filter(
          (batch) =>
            batch.status !== "Fully Packed" &&
            batch.remainingPieces > 0 &&
            batch.productName?.toLowerCase().includes("sausage"),
        );
        setSausageProcessingBatches(sausage);
        setFilteredSausage(sausage);
      }
    } catch (error) {
      console.error("Failed to load sausage batches", error);
    }
  };

  const loadDebonnedMeat = async () => {
    try {
      const coldStockKey = getStockKeyForStore("cold");
      const coldStock = await AsyncStorage.getItem(coldStockKey);
      if (coldStock) {
        const stockList = JSON.parse(coldStock);
        const debonnedItems = stockList.filter(
          (item) =>
            item.isDebonned === true &&
            item.currentWeight > 0.01 &&
            item.status !== "Fully Packed",
        );
        setDebonnedMeatItems(debonnedItems);
        setFilteredMeat(debonnedItems);
      }
    } catch (error) {
      console.error("Failed to load debonned meat", error);
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
      if (stored) {
        const products = JSON.parse(stored);
        setPackedProducts(products);
      }
    } catch (error) {
      console.error("Failed to load packed products", error);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      loadSausageBatches(),
      loadDebonnedMeat(),
      loadPackingRecords(),
      loadPackedProducts(),
    ]);
    setRefreshing(false);
  };

  const handleSausagePack = () => {
    if (!selectedItem) {
      ToastAndroid.show("Please select a sausage batch", ToastAndroid.SHORT);
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

    if (pieces > selectedItem.remainingPieces) {
      ToastAndroid.show(
        `Only ${selectedItem.remainingPieces} pieces available`,
        ToastAndroid.SHORT,
      );
      return;
    }

    const packsProduced = Math.floor(pieces / selectedItem.piecesPerPack);
    const remainingPiecesAfter = pieces % selectedItem.piecesPerPack;

    Alert.alert(
      "Confirm Packing",
      `Product: ${selectedItem.productName}\n` +
        `Pieces to pack: ${pieces}\n` +
        `Packs produced: ${packsProduced}\n` +
        `Remaining pieces: ${remainingPiecesAfter}\n\n` +
        `Proceed with packing?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Confirm",
          onPress: () =>
            confirmSausagePack(pieces, packsProduced, remainingPiecesAfter),
        },
      ],
    );
  };

  const confirmSausagePack = async (
    pieces,
    packsProduced,
    remainingPiecesAfter,
  ) => {
    setIsProcessing(true);
    try {
      const packBatchNumbers = [];
      const packedItems = [];

      for (let i = 0; i < packsProduced; i++) {
        const packNumber = packCounter + i;
        const productCode = selectedItem.productName
          .toUpperCase()
          .replace(/\s+/g, "-")
          .substring(0, 15);
        const packBatchNumber = `${productCode}-PACK-${String(packNumber).padStart(3, "0")}`;
        packBatchNumbers.push(packBatchNumber);

        const packId = generatePackId("SAUSAGE", packNumber);
        packedItems.push({
          id: packId,
          packId: packId,
          packNumber: packNumber,
          packBatchNumber: packBatchNumber,
          productName: selectedItem.productName,
          packSize: selectedItem.packSize,
          piecesPerPack: selectedItem.piecesPerPack,
          processingBatchCode: selectedItem.batchCode,
          status: "In Stock",
          timestamp: new Date().toLocaleString(),
          date: new Date().toISOString(),
        });
      }

      const packingRecord = {
        id: Date.now().toString(),
        type: "sausage",
        processingBatchId: selectedItem.id,
        processingBatchCode: selectedItem.batchCode,
        productName: selectedItem.productName,
        packSize: selectedItem.packSize,
        piecesPerPack: selectedItem.piecesPerPack,
        piecesPacked: pieces,
        packsProduced: packsProduced,
        remainingPieces: remainingPiecesAfter,
        packBatchNumbers: packBatchNumbers,
        packedItems: packedItems,
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
        (b) => b.id === selectedItem.id,
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
      packedProductsList.push(...packedItems);
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

      setSelectedItem(null);
      setPiecesToPack("");
      await onRefresh();
    } catch (error) {
      console.error("Failed to save packing record", error);
      ToastAndroid.show("Error saving packing record", ToastAndroid.SHORT);
    } finally {
      setIsProcessing(false);
    }
  };

  const openMeatConfigModal = (item) => {
    setSelectedDebonnedItem(item);
    setMeatType("");
    setKgToPack("");
    setPackSizeGrams("");
    setPiecesPerPack("");
    setCalculatedPieces(0);
    setCalculatedPacks(0);
    setRemainingWeightAfterPack(item.currentWeight);
    setMeatConfigModalVisible(true);
  };

  const confirmMeatPack = async () => {
    if (!meatType.trim()) {
      ToastAndroid.show(
        "Please enter meat type (Steak, Ribs, Liver, etc.)",
        ToastAndroid.SHORT,
      );
      return;
    }

    const kgToPackNum = parseFloat(kgToPack);
    if (isNaN(kgToPackNum) || kgToPackNum <= 0) {
      ToastAndroid.show("Please enter valid KGs to pack", ToastAndroid.SHORT);
      return;
    }

    if (kgToPackNum > selectedDebonnedItem.currentWeight) {
      ToastAndroid.show(
        `Only ${selectedDebonnedItem.currentWeight.toFixed(3)} kg available`,
        ToastAndroid.SHORT,
      );
      return;
    }

    if (!packSizeGrams || parseFloat(packSizeGrams) <= 0) {
      ToastAndroid.show(
        "Please enter valid pack size (grams)",
        ToastAndroid.SHORT,
      );
      return;
    }

    const packSizeKg = parseFloat(packSizeGrams) / 1000;
    const piecesPerPackNum = parseInt(piecesPerPack) || 1;
    const totalPiecesPossible = Math.floor(kgToPackNum / packSizeKg);
    const packsProduced = Math.floor(totalPiecesPossible / piecesPerPackNum);
    const packedWeight = packsProduced * piecesPerPackNum * packSizeKg;

    if (packsProduced === 0) {
      ToastAndroid.show(
        `Not enough meat for this pack size. Need at least ${(piecesPerPackNum * packSizeKg).toFixed(3)} kg`,
        ToastAndroid.LONG,
      );
      return;
    }

    const fullProductName = `${selectedDebonnedItem.type.replace(" (Debonned)", "")} ${meatType} ${packSizeGrams}g`;

    Alert.alert(
      "Confirm Meat Packing",
      `Meat: ${selectedDebonnedItem.type}\n` +
        `Meat Type: ${meatType}\n` +
        `KGs to pack: ${kgToPackNum.toFixed(3)} kg\n` +
        `Pack Size: ${packSizeGrams}g\n` +
        `Pieces per pack: ${piecesPerPackNum}\n` +
        `Total pieces: ${totalPiecesPossible}\n` +
        `Packs to produce: ${packsProduced}\n` +
        `Packed weight: ${packedWeight.toFixed(3)} kg\n` +
        `Remaining from this allocation: ${(kgToPackNum - packedWeight).toFixed(3)} kg (waste/cut loss)\n` +
        `Total remaining in batch: ${(selectedDebonnedItem.currentWeight - kgToPackNum).toFixed(3)} kg\n\n` +
        `Proceed with packing?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Confirm",
          onPress: () =>
            confirmMeatPackProcess(
              kgToPackNum,
              packsProduced,
              piecesPerPackNum,
              packSizeKg,
              packedWeight,
              fullProductName,
            ),
        },
      ],
    );
  };

  const confirmMeatPackProcess = async (
    kgToPackNum,
    packsProduced,
    piecesPerPackNum,
    packSizeKg,
    packedWeight,
    fullProductName,
  ) => {
    setIsProcessing(true);
    setMeatConfigModalVisible(false);

    try {
      const packBatchNumbers = [];
      const packedItems = [];
      const meatBase = selectedDebonnedItem.type.replace(" (Debonned)", "");

      for (let i = 0; i < packsProduced; i++) {
        const packNumber = meatPackCounter + i;
        const packBatchNumber = `${meatBase.toUpperCase()}-PACK-${String(packNumber).padStart(3, "0")}`;
        packBatchNumbers.push(packBatchNumber);

        const packId = generatePackId("MEAT", packNumber);

        packedItems.push({
          id: packId,
          packId: packId,
          packNumber: packNumber,
          packBatchNumber: packBatchNumber,
          productName: fullProductName,
          meatType: meatType,
          meatBase: meatBase,
          packSize: parseFloat(packSizeGrams),
          piecesPerPack: piecesPerPackNum,
          totalWeight: piecesPerPackNum * packSizeKg,
          processingBatchCode: selectedDebonnedItem.batchCode,
          status: "In Stock",
          kgsUsed: kgToPackNum,
          packedWeight: packedWeight,
          timestamp: new Date().toLocaleString(),
          date: new Date().toISOString(),
        });
      }

      const packingRecord = {
        id: Date.now().toString(),
        type: "meat",
        processingBatchId: selectedDebonnedItem.id,
        processingBatchCode: selectedDebonnedItem.batchCode,
        productName: fullProductName,
        meatType: meatType,
        meatBase: meatBase,
        packSize: parseFloat(packSizeGrams),
        piecesPerPack: piecesPerPackNum,
        kgsAllocated: kgToPackNum,
        kgsPacked: packedWeight,
        kgsWaste: kgToPackNum - packedWeight,
        packsProduced: packsProduced,
        packBatchNumbers: packBatchNumbers,
        packedItems: packedItems,
        timestamp: new Date().toLocaleString(),
        date: new Date().toISOString(),
      };

      const [existingRecords, coldStock, currentPackedProducts] =
        await Promise.all([
          AsyncStorage.getItem(PACKING_RECORDS_KEY),
          AsyncStorage.getItem(getStockKeyForStore("cold")),
          AsyncStorage.getItem(PACKED_PRODUCTS_KEY),
        ]);

      let records = existingRecords ? JSON.parse(existingRecords) : [];
      let coldStockList = coldStock ? JSON.parse(coldStock) : [];
      let packedProductsList = currentPackedProducts
        ? JSON.parse(currentPackedProducts)
        : [];

      records.unshift(packingRecord);

      const meatIndex = coldStockList.findIndex(
        (item) => item.id === selectedDebonnedItem.id,
      );
      if (meatIndex !== -1) {
        const newWeight = selectedDebonnedItem.currentWeight - kgToPackNum;
        coldStockList[meatIndex].currentWeight = newWeight;
        coldStockList[meatIndex].totalWeight = newWeight;
        coldStockList[meatIndex].lastUpdated = new Date().toISOString();

        if (!coldStockList[meatIndex].packedItems) {
          coldStockList[meatIndex].packedItems = [];
        }
        coldStockList[meatIndex].packedItems.push({
          meatType: meatType,
          kgsUsed: kgToPackNum,
          packsProduced: packsProduced,
          packSize: packSizeGrams,
          timestamp: new Date().toISOString(),
        });

        if (newWeight <= 0.01) {
          coldStockList[meatIndex].status = "Fully Packed";
        } else {
          coldStockList[meatIndex].status = "Partially Packed";
        }
      }

      packedProductsList.push(...packedItems);

      await Promise.all([
        AsyncStorage.setItem(PACKING_RECORDS_KEY, JSON.stringify(records)),
        AsyncStorage.setItem(
          getStockKeyForStore("cold"),
          JSON.stringify(coldStockList),
        ),
        AsyncStorage.setItem(
          PACKED_PRODUCTS_KEY,
          JSON.stringify(packedProductsList),
        ),
      ]);

      syncToFirebase(
        "packingRecords",
        packingRecord,
        store.getState().settings.BusinessId,
      );

      const newPackCounter = meatPackCounter + packsProduced;
      setMeatPackCounter(newPackCounter);
      await saveMeatPackCounter(newPackCounter);

      ToastAndroid.show(
        `Packed ${packsProduced} packs of ${fullProductName} (${packedWeight.toFixed(3)} kg)`,
        ToastAndroid.LONG,
      );

      setMeatType("");
      setKgToPack("");
      setPackSizeGrams("");
      setPiecesPerPack("");
      setSelectedDebonnedItem(null);

      await onRefresh();
    } catch (error) {
      console.error("Failed to save meat packing record:", error);
      ToastAndroid.show("Error saving packing record", ToastAndroid.SHORT);
    } finally {
      setIsProcessing(false);
    }
  };

  const renderSausageBatch = ({ item }) => (
    <TouchableOpacity
      style={[
        styles.stockItem,
        { backgroundColor: selectedItem?.id === item.id ? "#D4E8FF" : "#FFF" },
      ]}
      onPress={() => setSelectedItem(item)}
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
      {selectedItem?.id === item.id && (
        <View style={[styles.removeButton, { backgroundColor: "#4CAF50" }]}>
          <Text style={styles.removeButtonText}>Selected</Text>
        </View>
      )}
    </TouchableOpacity>
  );

  const renderDebonnedMeatItem = ({ item }) => (
    <View style={styles.stockItem}>
      <View style={styles.stockDetails}>
        <Text style={styles.stockType}>{item.type}</Text>
        <Text style={styles.stockInfo}>Batch: {item.batchCode}</Text>
        <Text style={styles.stockInfo}>
          Available: {item.currentWeight?.toFixed(3)} kg
        </Text>
        <Text style={styles.stockInfo}>
          Original: {item.weightAfterDebonning?.toFixed(3)} kg
        </Text>
        <Text style={styles.stockInfo}>
          Variance: {item.variance?.toFixed(3)} kg ({item.variancePercent}%)
        </Text>
        <Text style={styles.stockInfo}>
          Status: {item.status || "Awaiting Packing"}
        </Text>
        <Text style={styles.stockDate}>Deboned: {item.timestamp}</Text>
      </View>
      <TouchableOpacity
        style={[styles.removeButton, { backgroundColor: "#0066CC" }]}
        onPress={() => openMeatConfigModal(item)}
        disabled={isProcessing}
      >
        <Text style={styles.removeButtonText}>Pack Meat</Text>
      </TouchableOpacity>
    </View>
  );

  const renderPackingRecord = ({ item }) => (
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
      <View style={styles.stockDetails}>
        <Text style={styles.stockType}>
          {item.type === "sausage" ? "Sausage Pack" : "Meat Pack"}
        </Text>
        <Text style={styles.stockInfo}>Product: {item.productName}</Text>
        <Text style={styles.stockInfo}>Pack Size: {item.packSize}g</Text>
        <Text style={styles.stockInfo}>
          Pieces per Pack: {item.piecesPerPack}
        </Text>
        <Text style={styles.stockInfo}>
          Packs Produced: {item.packsProduced}
        </Text>
        {item.type === "meat" && (
          <>
            <Text style={styles.stockInfo}>
              KGs Allocated: {item.kgsAllocated?.toFixed(3)} kg
            </Text>
            <Text style={styles.stockInfo}>
              KGs Packed: {item.kgsPacked?.toFixed(3)} kg
            </Text>
            {item.kgsWaste > 0 && (
              <Text style={styles.stockInfo}>
                Waste/Cut Loss: {item.kgsWaste?.toFixed(3)} kg
              </Text>
            )}
          </>
        )}
        <Text style={styles.stockDate}>Packed: {item.timestamp}</Text>
      </View>
    </View>
  );

  const renderGroupedInventoryItem = ({ item }) => (
    <View style={[styles.stockItem, { backgroundColor: "#F0FFF0" }]}>
      <View style={styles.stockDetails}>
        <Text style={styles.stockType}>{item.productName}</Text>
        <Text style={styles.stockInfo}>Pack Size: {item.packSize}g</Text>
        <Text style={styles.stockInfo}>{item.piecesPerPack} pcs/pack</Text>
        <Text
          style={[
            styles.stockInfo,
            { fontWeight: "bold", fontSize: 16, color: "#0066CC" },
          ]}
        >
          Total Packs: {item.totalPacks}
        </Text>
        <Text style={styles.stockInfo}>
          Total Weight: {item.totalWeight.toFixed(2)} kg
        </Text>
        <Text style={styles.stockInfo}>
          Batch Range: {item.packBatchNumbers[0]} to{" "}
          {item.packBatchNumbers[item.packBatchNumbers.length - 1]}
        </Text>
        <Text style={styles.stockDate}>Status: In Stock</Text>
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

        <View style={styles.tabContainer}>
          <TouchableOpacity
            style={[styles.tab, activeTab === "sausage" && styles.activeTab]}
            onPress={() => {
              setActiveTab("sausage");
              setSelectedItem(null);
              setPiecesToPack("");
            }}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === "sausage" && styles.activeTabText,
              ]}
            >
              Sausages
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === "meat" && styles.activeTab]}
            onPress={() => {
              setActiveTab("meat");
              setSelectedItem(null);
              setPiecesToPack("");
            }}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === "meat" && styles.activeTabText,
              ]}
            >
              Meat
            </Text>
          </TouchableOpacity>
        </View>

        {activeTab === "sausage" ? (
          <>
            <Text style={styles.sectionHeader}>
              Sausage Batches Ready for Packing
            </Text>
            <TextInput
              style={styles.searchInput}
              placeholder="Search..."
              value={searchText}
              onChangeText={setSearchText}
            />
            <FlatList
              data={filteredSausage}
              keyExtractor={(item) => item.id}
              renderItem={renderSausageBatch}
              ListEmptyComponent={
                <Text style={styles.emptyText}>
                  No sausage batches available
                </Text>
              }
              scrollEnabled={false}
            />

            {selectedItem && (
              <>
                <Text style={styles.sectionHeader}>
                  Sausage Pack Configuration
                </Text>
                <View style={styles.recipeSummary}>
                  <Text style={styles.stockInfo}>
                    Product: {selectedItem.productName}
                  </Text>
                  <Text style={styles.stockInfo}>
                    Pack Size: {selectedItem.packSize}g
                  </Text>
                  <Text style={styles.stockInfo}>
                    Pieces per Pack: {selectedItem.piecesPerPack}
                  </Text>
                  <Text style={styles.stockInfo}>
                    Available: {selectedItem.remainingPieces} pieces
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
                    <Text style={styles.recordsHeader}>Output:</Text>
                    <Text style={styles.stockInfo}>
                      Packs:{" "}
                      {Math.floor(
                        parseInt(piecesToPack) / selectedItem.piecesPerPack,
                      )}
                    </Text>
                    <Text style={styles.stockInfo}>
                      Remaining pieces:{" "}
                      {parseInt(piecesToPack) % selectedItem.piecesPerPack}
                    </Text>
                  </View>
                )}

                <TouchableOpacity
                  style={styles.saveButton}
                  onPress={handleSausagePack}
                  disabled={isProcessing}
                >
                  <Text style={styles.saveButtonText}>
                    {isProcessing ? "Processing..." : "Process Packing"}
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </>
        ) : (
          <>
            <Text style={styles.sectionHeader}>
              Debonned Meat Ready for Packing
            </Text>
            <Text style={styles.instructionText}>
              Select meat below. You can pack different cuts (Steak, Ribs,
              Liver, etc.) from the same batch, each with its own KG allocation.
            </Text>
            <TextInput
              style={styles.searchInput}
              placeholder="Search..."
              value={searchText}
              onChangeText={setSearchText}
            />
            <FlatList
              data={filteredMeat}
              keyExtractor={(item) => item.id}
              renderItem={renderDebonnedMeatItem}
              ListEmptyComponent={
                <Text style={styles.emptyText}>No debonned meat available</Text>
              }
              scrollEnabled={false}
            />
          </>
        )}

        <Text style={styles.recordsHeader}>Packing History</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Search..."
          value={recordsSearchText}
          onChangeText={setRecordsSearchText}
        />
        <FlatList
          data={filteredRecords}
          keyExtractor={(item) => item.id}
          renderItem={renderPackingRecord}
          ListEmptyComponent={<Text style={styles.emptyText}>No records</Text>}
          scrollEnabled={false}
        />

        <Text style={styles.recordsHeader}>Inventory (In Stock)</Text>
        <FlatList
          data={groupedInventory}
          keyExtractor={(item) => item.id}
          renderItem={renderGroupedInventoryItem}
          ListEmptyComponent={
            <Text style={styles.emptyText}>No products in inventory</Text>
          }
          scrollEnabled={false}
        />

        <View style={{ height: responsiveSize(20) }} />
      </View>

      {/* Meat Packing Configuration Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={meatConfigModalVisible}
        onRequestClose={() => !isProcessing && setMeatConfigModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <ScrollView
            style={{ maxHeight: "80%" }}
            showsVerticalScrollIndicator={false}
          >
            <View style={[styles.modalContent, { width: "90%" }]}>
              <Text style={styles.modalTitle}>Pack Meat</Text>
              <Text style={styles.modalSubtitle}>
                Batch: {selectedDebonnedItem?.batchCode}
              </Text>
              <Text style={styles.modalSubtitle}>
                Available: {selectedDebonnedItem?.currentWeight?.toFixed(3)} kg
              </Text>

              <View
                style={{
                  height: 1,
                  backgroundColor: "#DDD",
                  marginVertical: 15,
                }}
              />

              <TextInput
                style={styles.inputField}
                placeholder="Meat Type (e.g., Steak, Ribs, Liver, Mince)"
                value={meatType}
                onChangeText={setMeatType}
                editable={!isProcessing}
              />

              <TextInput
                style={styles.inputField}
                placeholder="KGs to pack (e.g., 50)"
                keyboardType="decimal-pad"
                value={kgToPack}
                onChangeText={setKgToPack}
                editable={!isProcessing}
              />

              <TextInput
                style={styles.inputField}
                placeholder="Pack Size (grams) e.g., 250"
                keyboardType="decimal-pad"
                value={packSizeGrams}
                onChangeText={setPackSizeGrams}
                editable={!isProcessing}
              />

              <TextInput
                style={styles.inputField}
                placeholder="Pieces per Pack (default: 1)"
                keyboardType="numeric"
                value={piecesPerPack}
                onChangeText={setPiecesPerPack}
                editable={!isProcessing}
              />

              {kgToPack &&
                parseFloat(kgToPack) > 0 &&
                packSizeGrams &&
                parseFloat(packSizeGrams) > 0 &&
                selectedDebonnedItem && (
                  <View style={styles.recipeSummary}>
                    <Text style={styles.recordsHeader}>Preview:</Text>
                    <Text style={styles.stockInfo}>
                      KGs to pack: {parseFloat(kgToPack).toFixed(3)} kg
                    </Text>
                    <Text style={styles.stockInfo}>
                      Piece weight:{" "}
                      {(parseFloat(packSizeGrams) / 1000).toFixed(3)} kg
                    </Text>
                    <Text style={styles.stockInfo}>
                      Total pieces: {calculatedPieces}
                    </Text>
                    {piecesPerPack && parseInt(piecesPerPack) > 0 ? (
                      <>
                        <Text style={styles.stockInfo}>
                          Pieces/pack: {piecesPerPack}
                        </Text>
                        <Text style={styles.stockInfo}>
                          Packs: {calculatedPacks}
                        </Text>
                        <Text style={styles.stockInfo}>
                          Packed weight:{" "}
                          {(
                            calculatedPacks *
                            parseInt(piecesPerPack) *
                            (parseFloat(packSizeGrams) / 1000)
                          ).toFixed(3)}{" "}
                          kg
                        </Text>
                        <Text style={[styles.stockInfo, { color: "#FF6600" }]}>
                          Waste/Cut loss:{" "}
                          {(
                            parseFloat(kgToPack) -
                            calculatedPacks *
                              parseInt(piecesPerPack) *
                              (parseFloat(packSizeGrams) / 1000)
                          ).toFixed(3)}{" "}
                          kg
                        </Text>
                      </>
                    ) : (
                      <>
                        <Text style={styles.stockInfo}>
                          Packs (1 piece/pack): {calculatedPieces}
                        </Text>
                        <Text style={styles.stockInfo}>
                          Packed weight:{" "}
                          {(
                            calculatedPieces *
                            (parseFloat(packSizeGrams) / 1000)
                          ).toFixed(3)}{" "}
                          kg
                        </Text>
                      </>
                    )}
                    <View
                      style={{
                        borderTopWidth: 1,
                        borderColor: "#DDD",
                        marginTop: 8,
                        paddingTop: 8,
                      }}
                    >
                      <Text style={styles.stockInfo}>
                        Remaining in batch after this pack:
                      </Text>
                      <Text
                        style={[
                          styles.stockInfo,
                          {
                            fontWeight: "bold",
                            color:
                              remainingWeightAfterPack > 0
                                ? "#4CAF50"
                                : "#FF0000",
                          },
                        ]}
                      >
                        {remainingWeightAfterPack.toFixed(3)} kg
                      </Text>
                    </View>
                  </View>
                )}

              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={[
                    styles.modalButton,
                    {
                      backgroundColor: "#4CAF50",
                      opacity: isProcessing ? 0.6 : 1,
                    },
                  ]}
                  onPress={confirmMeatPack}
                  disabled={isProcessing}
                >
                  <Text style={styles.modalButtonText}>
                    {isProcessing ? "Processing..." : "Confirm Packing"}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.modalButton,
                    {
                      backgroundColor: "#FF4444",
                      opacity: isProcessing ? 0.6 : 1,
                    },
                  ]}
                  onPress={() =>
                    !isProcessing && setMeatConfigModalVisible(false)
                  }
                  disabled={isProcessing}
                >
                  <Text style={styles.modalButtonText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </ScrollView>
  );
};

// ============ PROCESSING SCREEN ============
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
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [productionPieces, setProductionPieces] = useState(1);
  const [processingBatchCounter, setProcessingBatchCounter] = useState(1);
  const [destinationScreen, setDestinationScreen] = useState(null);
  const [stockCheckResult, setStockCheckResult] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [usedStockRecords, setUsedStockRecords] = useState([]);

  const searchTimer = useRef(null);
  const dryGoodsTimer = useRef(null);
  const carcassTimer = useRef(null);
  const recipeTimer = useRef(null);

  useEffect(() => {
    loadAllData();
    loadProcessingBatchCounter();
    loadUsedStockRecords();
  }, []);

  const loadUsedStockRecords = async () => {
    try {
      const stored = await AsyncStorage.getItem(USED_STOCK_KEY);
      if (stored) {
        setUsedStockRecords(JSON.parse(stored));
      }
    } catch (error) {
      console.error("Failed to load used stock records:", error);
    }
  };

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

  const loadAllData = async () => {
    await Promise.all([
      loadProcessingRecords(),
      loadDryGoodsStock(),
      loadCarcassItems(),
      loadSavedRecipes(),
      loadUsedStockRecords(),
    ]);
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
          label: `${item.description || item.itemCode || item.type} (${item.totalWeight.toFixed(3)} kg)`,
          value: item.itemCode || item.type,
          displayName: item.description || item.itemCode || item.type,
          description: item.description || "",
          unit: item.unit || "KG",
          type: item.type,
          totalWeight: item.totalWeight,
          id: item.id,
          itemCode: item.itemCode,
          batchNumber: item.batchNumber,
          bomType: item.bomType,
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
          itemCode: item.itemCode,
          bomType: item.bomType,
        }));
        setCarcassItems(items);
        setFilteredCarcass(items);
      }
    } catch (error) {
      console.error("Failed to load carcass", error);
    }
  };

  const checkStockAvailability = (requirements) => {
    const missingItems = [];
    for (const req of requirements.dryGoods) {
      const stockItem = dryGoodsStock.find(
        (s) => s.itemCode === req.itemId || s.type === req.itemId,
      );
      if (!stockItem || stockItem.totalWeight < req.totalAmount) {
        const available = stockItem ? stockItem.totalWeight : 0;
        missingItems.push({
          name: req.itemName,
          needed: req.totalAmount,
          available: available,
          type: "dry",
          unit: "kg",
        });
      }
    }
    for (const req of requirements.carcasses) {
      const carcassItem = carcassItems.find((c) => c.id === req.itemId);
      if (!carcassItem || carcassItem.currentWeight < req.totalAmount) {
        const available = carcassItem ? carcassItem.currentWeight : 0;
        missingItems.push({
          name: req.itemName,
          needed: req.totalAmount,
          available: available,
          type: "carcass",
          unit: "kg",
        });
      }
    }
    return missingItems;
  };

  const calculateMaxPiecesFromStock = (requirements) => {
    let maxPieces = Infinity;
    for (const req of requirements.dryGoods) {
      const stockItem = dryGoodsStock.find(
        (s) => s.itemCode === req.itemId || s.type === req.itemId,
      );
      if (stockItem) {
        const maxForItem = Math.floor(
          stockItem.totalWeight / req.amountPerPiece,
        );
        maxPieces = Math.min(maxPieces, maxForItem);
      } else {
        return 0;
      }
    }
    for (const req of requirements.carcasses) {
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
    setStockCheckResult(null);
    ToastAndroid.show(
      `Recipe: ${recipe.name}. Enter quantity to check availability.`,
      ToastAndroid.LONG,
    );
  };

  const calculateRecipeRequirements = (quantity) => {
    if (!selectedRecipe) return null;
    const requirements = { dryGoods: [], carcasses: [] };
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
      }
    }
    return requirements;
  };

  const checkStockForQuantity = (quantity) => {
    const requirements = calculateRecipeRequirements(quantity);
    if (!requirements) return null;
    const missingItems = checkStockAvailability(requirements);
    const maxPieces = calculateMaxPiecesFromStock(requirements);
    return {
      requirements,
      missingItems,
      maxPieces,
      isFullyAvailable: missingItems.length === 0,
    };
  };

  const applyRecipe = async () => {
    const quantity = parseFloat(productionPieces);
    if (isNaN(quantity) || quantity <= 0) {
      ToastAndroid.show("Enter valid quantity", ToastAndroid.SHORT);
      return;
    }

    const result = checkStockForQuantity(quantity);
    if (!result) return;

    const { requirements, missingItems, maxPieces, isFullyAvailable } = result;

    if (!isFullyAvailable) {
      const maxPacks = Math.floor(maxPieces / selectedRecipe.piecesPerPack);
      const remainingPieces = maxPieces % selectedRecipe.piecesPerPack;
      let message = "❌ Insufficient Stock!\n\n";
      message += `You requested ${quantity} pieces.\n`;
      message += `Maximum possible with current stock: ${maxPieces} pieces (${maxPacks} packs + ${remainingPieces} pieces)\n\n`;
      message += "⚠️ Missing Ingredients:\n";
      missingItems.forEach((item) => {
        message += `• ${item.name}: Need ${item.needed.toFixed(3)} ${item.unit}, Have ${item.available.toFixed(3)} ${item.unit}\n`;
        message += `  → Refill: ${(item.needed - item.available).toFixed(3)} ${item.unit}\n`;
      });

      Alert.alert("Stock Insufficient", message, [
        { text: "Cancel", style: "cancel" },
        {
          text: `Use Max (${maxPieces} pieces)`,
          onPress: () => {
            setProductionPieces(maxPieces);
            setTimeout(() => applyRecipeWithMax(maxPieces), 100);
          },
        },
      ]);
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

  const saveUsedStockRecord = async (record) => {
    try {
      const stored = await AsyncStorage.getItem(USED_STOCK_KEY);
      let records = stored ? JSON.parse(stored) : [];
      records.unshift(record);
      await AsyncStorage.setItem(USED_STOCK_KEY, JSON.stringify(records));
      setUsedStockRecords(records);
    } catch (error) {
      console.error("Failed to save used stock record:", error);
    }
  };

  const handleProcess = async () => {
    if (isProcessing) {
      ToastAndroid.show(
        "Processing already in progress...",
        ToastAndroid.SHORT,
      );
      return;
    }

    if (!itemToProcess.trim()) {
      ToastAndroid.show("Enter product name", ToastAndroid.SHORT);
      return;
    }
    if (selectedDryGoods.length === 0 && selectedCarcasses.length === 0) {
      ToastAndroid.show("Select ingredients", ToastAndroid.SHORT);
      return;
    }

    setIsProcessing(true);

    try {
      const totalPiecesProduced =
        selectedCarcasses.reduce(
          (sum, c) => sum + (c.piecesProduced || 1),
          0,
        ) || 1;
      const packSize = selectedRecipe?.packSize || 500;
      const piecesPerPack = selectedRecipe?.piecesPerPack || 22;

      const usedDryGoodsDetails = [];
      const usedCarcassesDetails = [];

      // Deduct from Dry Goods Store
      for (const dg of selectedDryGoods) {
        const used = selectedDryGoodsAmounts[dg.value] || 0;
        if (used > 0) {
          const dryStockKey = getStockKeyForStore("dry");
          const dryStock = await AsyncStorage.getItem(dryStockKey);
          let list = dryStock ? JSON.parse(dryStock) : [];
          const idx = list.findIndex(
            (d) => d.itemCode === dg.value || d.type === dg.value,
          );
          if (idx !== -1) {
            const item = list[idx];
            const remaining = item.totalWeight - used;

            usedDryGoodsDetails.push({
              id: item.id,
              itemCode: item.itemCode,
              description: item.description || item.type,
              unit: item.unit || "KG",
              amountUsed: used,
              remainingWeight: remaining,
              batchNumber: item.batchNumber,
              bomType: item.bomType,
              productMade: itemToProcess,
              timestamp: new Date().toISOString(),
            });

            if (remaining <= 0) {
              list.splice(idx, 1);
            } else {
              list[idx].totalWeight = remaining;
              list[idx].lastUpdated = new Date().toISOString();
            }
            await AsyncStorage.setItem(dryStockKey, JSON.stringify(list));

            const businessId = store.getState().settings.BusinessId;
            for (const item of list) {
              syncToFirebase("dry_goods_stock", item, businessId);
            }
          }
        }
      }

      // Deduct from Coldroom (Carcasses)
      const carcassesUsedDetails = [];
      for (const carcass of selectedCarcasses) {
        const weightUsed = carcass.weightToUse;
        if (weightUsed > 0) {
          const coldStockKey = getStockKeyForStore("cold");
          const coldStock = await AsyncStorage.getItem(coldStockKey);
          let coldStockList = coldStock ? JSON.parse(coldStock) : [];
          const idx = coldStockList.findIndex((c) => c.id === carcass.id);
          if (idx !== -1) {
            const item = coldStockList[idx];
            const remainingWeight = item.currentWeight - weightUsed;

            usedCarcassesDetails.push({
              id: item.id,
              type: item.type,
              batchCode: item.batchCode,
              weightUsed: weightUsed,
              remainingWeight: remainingWeight,
              originalWeight: item.weightAfterDebonning || item.totalWeight,
              productMade: itemToProcess,
              timestamp: new Date().toISOString(),
            });

            coldStockList[idx].currentWeight = remainingWeight;
            coldStockList[idx].totalWeight = remainingWeight;
            coldStockList[idx].lastUpdated = new Date().toISOString();
            coldStockList[idx].usedInProcessing = true;
            coldStockList[idx].usedForProduct = itemToProcess;
            coldStockList[idx].weightUsed = weightUsed;

            if (remainingWeight <= 0) {
              coldStockList.splice(idx, 1);
            }
            await AsyncStorage.setItem(
              coldStockKey,
              JSON.stringify(coldStockList),
            );

            const businessId = store.getState().settings.BusinessId;
            for (const item of coldStockList) {
              syncToFirebase("cold_room_stock", item, businessId);
            }

            carcassesUsedDetails.push({
              id: carcass.id,
              batchCode: carcass.batchCode,
              type: carcass.type,
              originalWeight: carcass.originalWeight,
              weightUsed: weightUsed,
              remainingWeight: remainingWeight,
              amountPerPiece: carcass.amountPerPiece || null,
              piecesProduced: carcass.piecesProduced || 1,
            });
          }
        }
      }

      // Save used stock records
      const usedStockRecord = {
        id: Date.now().toString(),
        productName: itemToProcess,
        batchCode: formatProcessingBatchCode(
          itemToProcess,
          processingBatchCounter,
        ),
        dryGoodsUsed: usedDryGoodsDetails,
        carcassesUsed: usedCarcassesDetails,
        totalPieces: totalPiecesProduced,
        timestamp: new Date().toISOString(),
        date: new Date().toLocaleString(),
      };
      await saveUsedStockRecord(usedStockRecord);

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
          name: dg.displayName || dg.label,
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
      await AsyncStorage.setItem(
        PROCESSING_RECORDS_KEY,
        JSON.stringify(records),
      );
      syncToFirebase(
        "processingRecords",
        record,
        store.getState().settings.BusinessId,
      );

      const packsEquivalent = Math.floor(totalPiecesProduced / piecesPerPack);
      const remainingPiecesTotal = totalPiecesProduced % piecesPerPack;

      ToastAndroid.show(
        `✅ Processed: ${itemToProcess}\n${totalPiecesProduced} pieces = ${packsEquivalent} packs + ${remainingPiecesTotal} pieces\nBatch: ${batchCode}`,
        ToastAndroid.LONG,
      );

      setItemToProcess("");
      setSelectedDryGoods([]);
      setSelectedDryGoodsAmounts({});
      setSelectedCarcasses([]);
      setProductionPieces(1);
      setSelectedRecipe(null);

      await loadAllData();

      Alert.alert(
        "✅ Processing Complete!",
        `Product: ${itemToProcess}\nTotal pieces: ${totalPiecesProduced}\nEquivalent packs: ${packsEquivalent} packs + ${remainingPiecesTotal} pieces\nBatch: ${batchCode}\n\nWhat would you like to do next?`,
        [
          {
            text: "📦 Go to Packing",
            onPress: () => setDestinationScreen("packing"),
          },
          { text: "🔄 Continue Processing", style: "cancel" },
        ],
      );
    } catch (error) {
      console.error("Processing error:", error);
      ToastAndroid.show(
        "Error processing. Please try again.",
        ToastAndroid.SHORT,
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadAllData();
    setRefreshing(false);
  };

  const renderRecipeItem = ({ item }) => {
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
            {item.items.slice(0, 3).map((ing, idx) => (
              <Text key={idx} style={styles.stockInfo}>
                • {ing.itemName}: {ing.amountPerPiece.toFixed(6)} kg/piece
              </Text>
            ))}
            {item.items.length > 3 && (
              <Text style={styles.stockInfo}>
                • ... and {item.items.length - 3} more
              </Text>
            )}
            <Text style={styles.stockDate}>Created: {item.createdAt}</Text>
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
            <Text style={styles.removeButtonText}>Use Recipe</Text>
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
        <Text style={styles.stockType}>{item.displayName || item.label}</Text>
        {item.description && (
          <Text style={styles.stockInfo}>Description: {item.description}</Text>
        )}
        {item.unit && <Text style={styles.stockInfo}>Unit: {item.unit}</Text>}
        <Text style={styles.stockInfo}>
          Available: {item.totalWeight?.toFixed(3) || "0.000"} kg
        </Text>
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
        <Text style={styles.stockType}>{item.displayName || item.label}</Text>
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
    const maxPieces = requirements
      ? calculateMaxPiecesFromStock(requirements)
      : 0;
    const missingItems = requirements
      ? checkStockAvailability(requirements)
      : [];
    const isFullyAvailable = missingItems.length === 0;

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
              setStockCheckResult(null);
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

          <Text style={styles.sectionHeader}>Production Quantity</Text>
          <TextInput
            style={styles.inputField}
            placeholder="Number of pieces to produce"
            keyboardType="numeric"
            value={productionPieces.toString()}
            onChangeText={(text) => {
              const val = parseInt(text) || 1;
              setProductionPieces(val);
              if (selectedRecipe) {
                const result = checkStockForQuantity(val);
                setStockCheckResult(result);
              }
            }}
          />

          {requirements && (
            <View
              style={[
                styles.recipeSummary,
                { backgroundColor: isFullyAvailable ? "#E8F5E9" : "#FFEBEE" },
              ]}
            >
              <Text
                style={[
                  styles.recordsHeader,
                  { color: isFullyAvailable ? "#2E7D32" : "#C62828" },
                ]}
              >
                {isFullyAvailable
                  ? "✅ All Ingredients Available!"
                  : "❌ Insufficient Stock"}
              </Text>
              <Text style={styles.stockInfo}>
                Requested: {productionPieces} pieces
              </Text>
              <Text style={styles.stockInfo}>
                Maximum possible: {maxPieces} pieces
              </Text>
              {maxPieces > 0 && (
                <Text style={styles.stockInfo}>
                  Max packs:{" "}
                  {Math.floor(maxPieces / selectedRecipe.piecesPerPack)} packs +{" "}
                  {maxPieces % selectedRecipe.piecesPerPack} pieces
                </Text>
              )}

              {missingItems.length > 0 && (
                <>
                  <Text
                    style={[
                      styles.stockInfo,
                      { fontWeight: "bold", marginTop: 8, color: "#C62828" },
                    ]}
                  >
                    ⚠️ Missing Ingredients - Please Refill:
                  </Text>
                  {missingItems.map((item, idx) => (
                    <View
                      key={idx}
                      style={{
                        backgroundColor: "#FFCDD2",
                        padding: 8,
                        borderRadius: 4,
                        marginTop: 4,
                      }}
                    >
                      <Text style={[styles.stockInfo, { color: "#B71C1C" }]}>
                        • {item.name}
                      </Text>
                      <Text
                        style={[
                          styles.stockInfo,
                          { color: "#B71C1C", marginLeft: 8 },
                        ]}
                      >
                        Need: {item.needed.toFixed(3)} {item.unit} | Have:{" "}
                        {item.available.toFixed(3)} {item.unit}
                      </Text>
                      <Text
                        style={[
                          styles.stockInfo,
                          {
                            color: "#D32F2F",
                            fontWeight: "bold",
                            marginLeft: 8,
                          },
                        ]}
                      >
                        → Refill: {(item.needed - item.available).toFixed(3)}{" "}
                        {item.unit}
                      </Text>
                    </View>
                  ))}
                </>
              )}

              {isFullyAvailable && (
                <Text
                  style={[styles.stockInfo, { color: "#2E7D32", marginTop: 8 }]}
                >
                  ✅ All ingredients available for {productionPieces} pieces!
                </Text>
              )}
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

          <TouchableOpacity
            style={[
              styles.saveButton,
              { backgroundColor: isFullyAvailable ? "#4CAF50" : "#FF9800" },
            ]}
            onPress={applyRecipe}
          >
            <Text style={styles.saveButtonText}>
              {isFullyAvailable
                ? "✅ Apply Recipe"
                : "⚠️ Apply with Available Stock"}
            </Text>
          </TouchableOpacity>

          {!isFullyAvailable && maxPieces > 0 && (
            <TouchableOpacity
              style={[
                styles.saveButton,
                { backgroundColor: "#2196F3", marginTop: 10 },
              ]}
              onPress={() => {
                setProductionPieces(maxPieces);
                setTimeout(() => applyRecipeWithMax(maxPieces), 100);
              }}
            >
              <Text style={styles.saveButtonText}>
                Use Max ({maxPieces} pieces)
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    );
  }

  if (destinationScreen === "packing") {
    return <PackingScreen onClose={() => setDestinationScreen(null)} />;
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

        {isProcessing && (
          <View
            style={[
              styles.recipeSummary,
              {
                backgroundColor: "#FFF3E0",
                flexDirection: "row",
                alignItems: "center",
              },
            ]}
          >
            <ActivityIndicator size="small" color="#FF9800" />
            <Text
              style={[styles.stockInfo, { color: "#FF9800", marginLeft: 8 }]}
            >
              ⏳ Processing... Please wait
            </Text>
          </View>
        )}

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
        <TouchableOpacity
          style={[
            styles.saveButton,
            isProcessing && { backgroundColor: "#999" },
          ]}
          onPress={handleProcess}
          disabled={isProcessing}
        >
          <Text style={styles.saveButtonText}>
            {isProcessing ? "⏳ Processing..." : "📝 Record Processing"}
          </Text>
        </TouchableOpacity>

        {/* Used Stock Records */}
        <Text style={styles.recordsHeader}>
          📊 Used Stock Records ({usedStockRecords.length})
        </Text>
        <FlatList
          data={usedStockRecords.slice(0, 10)}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View
              style={[
                styles.stockItem,
                {
                  backgroundColor: "#FFF8E1",
                  flexDirection: "column",
                  alignItems: "stretch",
                },
              ]}
            >
              <View style={styles.stockDetails}>
                <Text style={styles.stockType}>
                  Product: {item.productName}
                </Text>
                <Text style={styles.stockInfo}>Batch: {item.batchCode}</Text>
                <Text style={styles.stockInfo}>
                  Total Pieces: {item.totalPieces}
                </Text>
                <Text style={styles.stockInfo}>Date: {item.date}</Text>
                {item.dryGoodsUsed && item.dryGoodsUsed.length > 0 && (
                  <>
                    <Text
                      style={[
                        styles.stockInfo,
                        { fontWeight: "bold", marginTop: 4, color: "#0066CC" },
                      ]}
                    >
                      📦 Dry Goods Used:
                    </Text>
                    {item.dryGoodsUsed.slice(0, 3).map((d, idx) => (
                      <Text
                        key={idx}
                        style={[
                          styles.stockInfo,
                          { marginLeft: 8, fontSize: 11 },
                        ]}
                      >
                        • {d.description || d.itemCode}:{" "}
                        {d.amountUsed.toFixed(3)} kg used, Remaining:{" "}
                        {d.remainingWeight.toFixed(3)} kg
                      </Text>
                    ))}
                    {item.dryGoodsUsed.length > 3 && (
                      <Text
                        style={[
                          styles.stockInfo,
                          { marginLeft: 8, fontSize: 10, color: "#888" },
                        ]}
                      >
                        ... and {item.dryGoodsUsed.length - 3} more
                      </Text>
                    )}
                  </>
                )}
                {item.carcassesUsed && item.carcassesUsed.length > 0 && (
                  <>
                    <Text
                      style={[
                        styles.stockInfo,
                        { fontWeight: "bold", marginTop: 4, color: "#FF6F00" },
                      ]}
                    >
                      🥩 Carcasses Used:
                    </Text>
                    {item.carcassesUsed.slice(0, 3).map((c, idx) => (
                      <Text
                        key={idx}
                        style={[
                          styles.stockInfo,
                          { marginLeft: 8, fontSize: 11 },
                        ]}
                      >
                        • {c.type || "Carcass"}: {c.weightUsed.toFixed(3)} kg
                        used, Remaining: {c.remainingWeight.toFixed(3)} kg
                      </Text>
                    ))}
                    {item.carcassesUsed.length > 3 && (
                      <Text
                        style={[
                          styles.stockInfo,
                          { marginLeft: 8, fontSize: 10, color: "#888" },
                        ]}
                      >
                        ... and {item.carcassesUsed.length - 3} more
                      </Text>
                    )}
                  </>
                )}
              </View>
            </View>
          )}
          ListEmptyComponent={
            <Text style={styles.emptyText}>No used stock records yet</Text>
          }
          scrollEnabled={false}
        />

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

// ============ DISPATCH SCREEN ============
const DispatchScreen = ({ onClose }) => {
  const [availableProducts, setAvailableProducts] = useState([]);
  const [filteredProducts, setFilteredProducts] = useState([]);
  const [searchText, setSearchText] = useState("");
  const [selectedProducts, setSelectedProducts] = useState([]);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [dispatchRecords, setDispatchRecords] = useState([]);
  const [filteredRecords, setFilteredRecords] = useState([]);
  const [recordsSearchText, setRecordsSearchText] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [receiptModalVisible, setReceiptModalVisible] = useState(false);
  const [lastDispatch, setLastDispatch] = useState(null);
  const [sausageCounter, setSausageCounter] = useState(1);
  const [meatCounter, setMeatCounter] = useState(1);

  const DISPATCH_KEY = "@dispatch_records";

  useEffect(() => {
    loadProducts();
    loadDispatchRecords();
    loadCounters();
  }, []);

  useEffect(() => {
    if (searchText.trim() === "") {
      setFilteredProducts(availableProducts);
    } else {
      const filtered = availableProducts.filter(
        (product) =>
          product?.productName
            ?.toLowerCase()
            .includes(searchText.toLowerCase()) ||
          product?.packBatchNumber
            ?.toLowerCase()
            .includes(searchText.toLowerCase()),
      );
      setFilteredProducts(filtered);
    }
  }, [searchText, availableProducts]);

  useEffect(() => {
    if (recordsSearchText.trim() === "") {
      setFilteredRecords(dispatchRecords);
    } else {
      const filtered = dispatchRecords.filter(
        (record) =>
          record?.customerName
            ?.toLowerCase()
            .includes(recordsSearchText.toLowerCase()) ||
          record?.dispatchNumber
            ?.toLowerCase()
            .includes(recordsSearchText.toLowerCase()),
      );
      setFilteredRecords(filtered);
    }
  }, [recordsSearchText, dispatchRecords]);

  const loadCounters = async () => {
    try {
      const sausageCounterStored = await AsyncStorage.getItem(
        "@sausage_dispatch_counter",
      );
      if (sausageCounterStored)
        setSausageCounter(parseInt(sausageCounterStored));
      const meatCounterStored = await AsyncStorage.getItem(
        "@meat_dispatch_counter",
      );
      if (meatCounterStored) setMeatCounter(parseInt(meatCounterStored));
    } catch (error) {
      console.error("Failed to load counters", error);
    }
  };

  const saveCounters = async (sausage, meat) => {
    try {
      await AsyncStorage.setItem(
        "@sausage_dispatch_counter",
        sausage.toString(),
      );
      await AsyncStorage.setItem("@meat_dispatch_counter", meat.toString());
    } catch (error) {
      console.error("Failed to save counters", error);
    }
  };

  const loadProducts = async () => {
    try {
      const stored = await AsyncStorage.getItem(PACKED_PRODUCTS_KEY);
      if (stored) {
        const products = JSON.parse(stored);
        const inStock = products.filter((p) => p.status === "In Stock");

        const grouped = {};
        inStock.forEach((product) => {
          const key = `${product.productName}-${product.packSize}g`;
          if (!grouped[key]) {
            grouped[key] = {
              id: key,
              productName: product.productName,
              packSize: product.packSize,
              piecesPerPack: product.piecesPerPack,
              totalPacks: 0,
              items: [],
            };
          }
          grouped[key].totalPacks++;
          grouped[key].items.push(product);
        });

        setAvailableProducts(Object.values(grouped));
        setFilteredProducts(Object.values(grouped));
      } else {
        setAvailableProducts([]);
        setFilteredProducts([]);
      }
    } catch (error) {
      console.error("Failed to load products", error);
      setAvailableProducts([]);
      setFilteredProducts([]);
    }
  };

  const loadDispatchRecords = async () => {
    try {
      const stored = await AsyncStorage.getItem(DISPATCH_KEY);
      if (stored) {
        const records = JSON.parse(stored);
        setDispatchRecords(records);
        setFilteredRecords(records);
      } else {
        setDispatchRecords([]);
        setFilteredRecords([]);
      }
    } catch (error) {
      console.error("Failed to load dispatch records", error);
      setDispatchRecords([]);
      setFilteredRecords([]);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadProducts(), loadDispatchRecords()]);
    setRefreshing(false);
  };

  const updateProductQuantity = (productId, quantity) => {
    const product = availableProducts.find((p) => p.id === productId);
    if (!product) return;

    const qty = parseInt(quantity) || 0;

    if (qty <= 0) {
      setSelectedProducts((prev) => prev.filter((p) => p.id !== productId));
      return;
    }

    if (qty > product.totalPacks) {
      ToastAndroid.show(
        `Only ${product.totalPacks} packs available`,
        ToastAndroid.SHORT,
      );
      return;
    }

    setSelectedProducts((prev) => {
      const existingIndex = prev.findIndex((p) => p.id === productId);
      if (existingIndex !== -1) {
        const updated = [...prev];
        updated[existingIndex] = { ...product, dispatchQuantity: qty };
        return updated;
      } else {
        return [...prev, { ...product, dispatchQuantity: qty }];
      }
    });
  };

  const getQuantityForProduct = (productId) => {
    const found = selectedProducts.find((p) => p.id === productId);
    return found ? found.dispatchQuantity.toString() : "0";
  };

  const getTotalItems = () => {
    return selectedProducts.reduce(
      (sum, p) => sum + (p.dispatchQuantity || 0),
      0,
    );
  };

  const generateDispatchNumber = () => {
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, "");
    const counter = sausageCounter + meatCounter;
    const newSausageCounter = sausageCounter + 1;
    const newMeatCounter = meatCounter + 1;
    setSausageCounter(newSausageCounter);
    setMeatCounter(newMeatCounter);
    saveCounters(newSausageCounter, newMeatCounter);
    return `DISPATCH-${dateStr}-${String(counter).padStart(4, "0")}`;
  };

  const processDispatch = async () => {
    if (selectedProducts.length === 0) {
      ToastAndroid.show(
        "Please select at least one product",
        ToastAndroid.SHORT,
      );
      return;
    }

    if (!customerName.trim()) {
      ToastAndroid.show("Please enter customer name", ToastAndroid.SHORT);
      return;
    }

    const dispatchNumber = generateDispatchNumber();
    const dispatchDetails = [];

    try {
      const allPacked = await AsyncStorage.getItem(PACKED_PRODUCTS_KEY);
      let packedList = allPacked ? JSON.parse(allPacked) : [];

      for (const selected of selectedProducts) {
        const availableItems = packedList.filter(
          (p) =>
            p.productName === selected.productName &&
            p.packSize === selected.packSize &&
            p.status === "In Stock",
        );

        const dispatchItems = availableItems.slice(
          0,
          selected.dispatchQuantity,
        );
        const dispatchIds = dispatchItems.map((item) => item.packId);

        dispatchDetails.push({
          productName: selected.productName,
          packSize: selected.packSize,
          piecesPerPack: selected.piecesPerPack,
          quantity: selected.dispatchQuantity,
          packIds: dispatchIds,
        });

        let dispatchedCount = 0;
        for (
          let i = 0;
          i < packedList.length && dispatchedCount < selected.dispatchQuantity;
          i++
        ) {
          if (
            packedList[i].productName === selected.productName &&
            packedList[i].packSize === selected.packSize &&
            packedList[i].status === "In Stock"
          ) {
            packedList[i].status = "Dispatched";
            packedList[i].dispatchedDate = new Date().toISOString();
            packedList[i].dispatchNumber = dispatchNumber;
            packedList[i].customerName = customerName.trim();
            dispatchedCount++;
          }
        }
      }

      await AsyncStorage.setItem(
        PACKED_PRODUCTS_KEY,
        JSON.stringify(packedList),
      );

      const dispatchRecord = {
        id: Date.now().toString(),
        dispatchNumber: dispatchNumber,
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim(),
        items: dispatchDetails,
        totalItems: getTotalItems(),
        timestamp: new Date().toLocaleString(),
        date: new Date().toISOString(),
      };

      const stored = await AsyncStorage.getItem(DISPATCH_KEY);
      let records = stored ? JSON.parse(stored) : [];
      records.unshift(dispatchRecord);
      await AsyncStorage.setItem(DISPATCH_KEY, JSON.stringify(records));
      syncToFirebase(
        "dispatch",
        dispatchRecord,
        store.getState().settings.BusinessId,
      );

      ToastAndroid.show(
        `Dispatched ${getTotalItems()} items!\nDispatch No: ${dispatchNumber}`,
        ToastAndroid.LONG,
      );

      setLastDispatch(dispatchRecord);
      setReceiptModalVisible(true);

      setSelectedProducts([]);
      setCustomerName("");
      setCustomerPhone("");
      onRefresh();
    } catch (error) {
      console.error("Failed to save dispatch record", error);
      ToastAndroid.show("Error saving dispatch record", ToastAndroid.SHORT);
    }
  };

  const renderProductItem = ({ item }) => {
    if (!item) return null;
    const currentQuantity = getQuantityForProduct(item.id);

    return (
      <View
        style={[
          styles.stockItem,
          { flexDirection: "column", alignItems: "stretch" },
        ]}
      >
        <View style={styles.stockDetails}>
          <Text style={styles.stockType}>{item.productName || "Unknown"}</Text>
          <Text style={styles.stockInfo}>Pack Size: {item.packSize || 0}g</Text>
          <Text style={styles.stockInfo}>
            Available: {item.totalPacks || 0} packs
          </Text>
          <Text style={styles.stockInfo}>
            {item.piecesPerPack || 0} pcs/pack
          </Text>
        </View>
        <View
          style={{ flexDirection: "row", alignItems: "center", marginTop: 8 }}
        >
          <Text style={[styles.stockInfo, { marginRight: 10 }]}>Qty:</Text>
          <TextInput
            style={[
              styles.inputField,
              { width: 80, height: 40, marginBottom: 0 },
            ]}
            keyboardType="numeric"
            value={currentQuantity}
            onChangeText={(text) => updateProductQuantity(item.id, text)}
          />
          <Text style={[styles.stockInfo, { marginLeft: 10 }]}>packs</Text>
        </View>
      </View>
    );
  };

  const renderDispatchRecord = ({ item }) => {
    if (!item) return null;
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
        <View style={styles.stockDetails}>
          <Text style={styles.stockType}>
            Dispatch No: {item.dispatchNumber || "N/A"}
          </Text>
          <Text style={styles.stockInfo}>
            Customer: {item.customerName || "N/A"}
          </Text>
          {item.customerPhone && (
            <Text style={styles.stockInfo}>Phone: {item.customerPhone}</Text>
          )}
          <Text style={styles.stockInfo}>
            Total Items: {item.totalItems || 0} packs
          </Text>
          <Text style={styles.stockInfo}>Products:</Text>
          {item.items &&
            item.items.map((prod, idx) => (
              <Text key={idx} style={[styles.stockInfo, { marginLeft: 10 }]}>
                • {prod.productName}: {prod.quantity} packs ({prod.packSize}g
                each)
              </Text>
            ))}
          <Text style={styles.stockDate}>
            Dispatched: {item.timestamp || "N/A"}
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
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.dryGoodsContainer}>
        <TouchableOpacity style={styles.backButton} onPress={onClose}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.dryGoodsTitle}>Dispatch</Text>
        <TouchableOpacity style={styles.refreshButtonSmall} onPress={onRefresh}>
          <Text style={styles.refreshButtonSmallText}>↻ Refresh</Text>
        </TouchableOpacity>

        <Text style={styles.sectionHeader}>
          Products Available for Dispatch
        </Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Search products..."
          value={searchText}
          onChangeText={setSearchText}
        />
        <FlatList
          data={filteredProducts}
          keyExtractor={(item) => item?.id || Math.random().toString()}
          renderItem={renderProductItem}
          ListEmptyComponent={
            <Text style={styles.emptyText}>No products available</Text>
          }
          scrollEnabled={false}
        />

        {selectedProducts.length > 0 && (
          <>
            <Text style={styles.sectionHeader}>Dispatch Summary</Text>
            <View style={styles.recipeSummary}>
              {selectedProducts.map((p, idx) => (
                <Text key={idx} style={styles.stockInfo}>
                  • {p.productName}: {p.dispatchQuantity} packs ({p.packSize}g
                  each)
                </Text>
              ))}
              <Text
                style={[styles.stockInfo, { fontWeight: "bold", marginTop: 8 }]}
              >
                Total: {getTotalItems()} packs
              </Text>
            </View>

            <TextInput
              style={styles.inputField}
              placeholder="Customer Name (required)"
              value={customerName}
              onChangeText={setCustomerName}
            />

            <TextInput
              style={styles.inputField}
              placeholder="Customer Phone (optional)"
              keyboardType="phone-pad"
              value={customerPhone}
              onChangeText={setCustomerPhone}
            />

            <TouchableOpacity
              style={styles.saveButton}
              onPress={processDispatch}
            >
              <Text style={styles.saveButtonText}>Process Dispatch</Text>
            </TouchableOpacity>
          </>
        )}

        <Text style={styles.recordsHeader}>
          Dispatch History ({dispatchRecords.length})
        </Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Search by customer or dispatch number..."
          value={recordsSearchText}
          onChangeText={setRecordsSearchText}
        />
        <FlatList
          data={filteredRecords}
          keyExtractor={(item) => item?.id || Math.random().toString()}
          renderItem={renderDispatchRecord}
          ListEmptyComponent={
            <Text style={styles.emptyText}>No dispatch records</Text>
          }
          scrollEnabled={false}
        />

        <View style={{ height: responsiveSize(20) }} />
      </View>

      <Modal
        animationType="slide"
        transparent={true}
        visible={receiptModalVisible}
        onRequestClose={() => setReceiptModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <ScrollView
            style={{ maxHeight: "80%" }}
            showsVerticalScrollIndicator={false}
          >
            <View style={[styles.modalContent, { width: "90%" }]}>
              <Text style={[styles.modalTitle, { fontSize: 24 }]}>
                DISPATCH RECEIPT
              </Text>
              <View
                style={{
                  borderBottomWidth: 1,
                  borderColor: "#DDD",
                  marginVertical: 10,
                }}
              />
              {lastDispatch && (
                <>
                  <Text style={styles.modalSubtitle}>
                    Dispatch No: {lastDispatch.dispatchNumber}
                  </Text>
                  <Text style={styles.modalSubtitle}>
                    Date: {lastDispatch.timestamp}
                  </Text>
                  <Text style={styles.modalSubtitle}>
                    Customer: {lastDispatch.customerName}
                  </Text>
                  {lastDispatch.customerPhone && (
                    <Text style={styles.modalSubtitle}>
                      Phone: {lastDispatch.customerPhone}
                    </Text>
                  )}
                  <View
                    style={{
                      borderBottomWidth: 1,
                      borderColor: "#DDD",
                      marginVertical: 10,
                    }}
                  />
                  <Text style={styles.modalSubtitle}>Items Dispatched:</Text>
                  {lastDispatch.items &&
                    lastDispatch.items.map((item, idx) => (
                      <Text
                        key={idx}
                        style={[styles.modalSubtitle, { marginLeft: 10 }]}
                      >
                        • {item.productName}: {item.quantity} packs (
                        {item.packSize}g each)
                      </Text>
                    ))}
                  <Text
                    style={[
                      styles.modalSubtitle,
                      { fontWeight: "bold", marginTop: 10 },
                    ]}
                  >
                    Total: {lastDispatch.totalItems} packs
                  </Text>
                  <View
                    style={{
                      borderBottomWidth: 1,
                      borderColor: "#DDD",
                      marginVertical: 10,
                    }}
                  />
                  <Text style={[styles.modalSubtitle, { textAlign: "center" }]}>
                    Thank you for your business!
                  </Text>
                </>
              )}
              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={[styles.modalButton, { backgroundColor: "#0066CC" }]}
                  onPress={() => setReceiptModalVisible(false)}
                >
                  <Text style={styles.modalButtonText}>Close</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>
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
  const [removalModalVisible, setRemovalModalVisible] = useState(false);
  const [selectedRemovalItem, setSelectedRemovalItem] = useState(null);
  const [removeWeight, setRemoveWeight] = useState("");
  const [removalReason, setRemovalReason] = useState("");
  const [decisionModalVisible, setDecisionModalVisible] = useState(false);
  const [capturedWeightData, setCapturedWeightData] = useState(null);

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

      try {
        const weightBeforeStored = await AsyncStorage.getItem(
          WEIGHT_BEFORE_DEBONNING_KEY,
        );
        let weightBeforeList = weightBeforeStored
          ? JSON.parse(weightBeforeStored)
          : [];
        const index = weightBeforeList.findIndex(
          (item) =>
            item.batchCode === selectedBatch.batchCode &&
            item.status === "pending",
        );
        if (index !== -1) {
          weightBeforeList[index].weightBefore = currentWeight;
          weightBeforeList[index].status = "weighed";
          weightBeforeList[index].dateWeighed = new Date().toLocaleString();
          await AsyncStorage.setItem(
            WEIGHT_BEFORE_DEBONNING_KEY,
            JSON.stringify(weightBeforeList),
          );
        }
      } catch (error) {
        console.error("Failed to update weight before record:", error);
      }

      setCapturedWeightData({
        weight: currentWeight,
        batch: selectedBatch,
        newBatch: newBatch,
      });

      setIsWeighing(false);
      setDecisionModalVisible(true);
    } catch (error) {
      console.error("Failed to save butchery batch", error);
      ToastAndroid.show("Error saving batch", ToastAndroid.SHORT);
    }
  };

  const handleDecision = async (destination) => {
    setDecisionModalVisible(false);

    if (destination === "packing") {
      ToastAndroid.show("🔄 Opening Packing section...", ToastAndroid.SHORT);
      if (onBatchCreated) {
        onBatchCreated("packing");
      }
    } else if (destination === "processing") {
      ToastAndroid.show("🔄 Opening Processing section...", ToastAndroid.SHORT);
      if (onBatchCreated) {
        onBatchCreated("processing");
      }
    } else {
      ToastAndroid.show(
        `✅ Weight captured: ${capturedWeightData?.weight?.toFixed(3)} kg`,
        ToastAndroid.SHORT,
      );
      setSelectedBatch(null);
      setCurrentWeight(null);
      loadCarcassBatches();
    }
  };

  const handleRemoveBefore = (item) => {
    setSelectedRemovalItem(item);
    setRemoveWeight("");
    setRemovalReason("");
    setRemovalModalVisible(true);
  };

  const confirmRemovalBefore = async () => {
    const weightToRemove = parseFloat(removeWeight);
    if (isNaN(weightToRemove) || weightToRemove <= 0) {
      ToastAndroid.show("Please enter a valid weight (kg)", ToastAndroid.SHORT);
      return;
    }
    if (weightToRemove > selectedRemovalItem.currentWeight) {
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

    try {
      const coldStockKey = getStockKeyForStore("cold");
      const coldStock = await AsyncStorage.getItem(coldStockKey);
      let coldStockList = coldStock ? JSON.parse(coldStock) : [];

      const idx = coldStockList.findIndex(
        (item) =>
          item.batchCode === selectedRemovalItem.batchCode && !item.isDebonned,
      );

      if (idx !== -1) {
        const newWeight = coldStockList[idx].totalWeight - weightToRemove;
        coldStockList[idx].totalWeight = newWeight;
        coldStockList[idx].lastUpdated = new Date().toISOString();
        coldStockList[idx].removalReason = reason;
        if (newWeight <= 0) {
          coldStockList.splice(idx, 1);
        }
        await AsyncStorage.setItem(coldStockKey, JSON.stringify(coldStockList));

        const businessId = store.getState().settings.BusinessId;
        for (const item of coldStockList) {
          await syncToFirebase("cold_room_stock", item, businessId);
        }

        const spoilageRecord = {
          id: Date.now().toString(),
          batchCode: selectedRemovalItem.batchCode,
          carcassType: selectedRemovalItem.carcassType,
          receivedWeight:
            selectedRemovalItem.originalReceivedWeight ||
            selectedRemovalItem.totalWeight,
          currentWeight: newWeight,
          pieces: selectedRemovalItem.totalPieces || 1,
          weightRemoved: weightToRemove,
          reason: reason,
          date: new Date().toLocaleString(),
          removedFrom: "Weight Before Debonning",
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
        syncToFirebase("spoilageRecords", spoilageRecord, businessId);

        const removalRecord = {
          id: Date.now().toString(),
          store: "cold",
          itemId: selectedRemovalItem.id,
          type: selectedRemovalItem.carcassType,
          weightRemoved: weightToRemove,
          batchCode: selectedRemovalItem.batchCode || "",
          reason: reason,
          date: new Date().toLocaleString(),
          isCarcass: true,
          isColdroom: true,
          isDebonned: false,
          remainingWeight: newWeight,
          removedFrom: "Weight Before Debonning",
        };

        let removalsList = await AsyncStorage.getItem(REMOVALS_KEY);
        removalsList = removalsList ? JSON.parse(removalsList) : [];
        removalsList.unshift(removalRecord);
        await AsyncStorage.setItem(REMOVALS_KEY, JSON.stringify(removalsList));
        syncToFirebase("stockRemovals", removalRecord, businessId);

        ToastAndroid.show(
          `Removed ${weightToRemove.toFixed(3)} kg from ${selectedRemovalItem.carcassType}`,
          ToastAndroid.LONG,
        );

        setRemovalModalVisible(false);
        setSelectedRemovalItem(null);
        setRemoveWeight("");
        setRemovalReason("");
        onRefresh();
      }
    } catch (error) {
      console.error("Failed to remove stock:", error);
      ToastAndroid.show("Error removing stock", ToastAndroid.SHORT);
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
          Weight Before Debonning:{" "}
          {item.weightBefore ? item.weightBefore.toFixed(3) : "0.000"} kg
        </Text>
        {item.spoilageRemoved > 0 && (
          <Text style={[styles.stockInfo, { color: "#FF4444" }]}>
            Spoilage Removed: {item.spoilageRemoved.toFixed(3)} kg
          </Text>
        )}
        <Text style={styles.stockInfo}>{item.totalPieces} pieces</Text>
        <Text style={styles.stockDate}>Date: {item.date}</Text>
      </View>
      <View style={{ flexDirection: "column", gap: 5 }}>
        <TouchableOpacity
          style={[
            styles.removeButton,
            { backgroundColor: "#0066CC", marginBottom: 5 },
          ]}
          onPress={() => startWeighing(item)}
        >
          <Text style={styles.removeButtonText}>Weigh Before</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.removeButton, { backgroundColor: "#FF4444" }]}
          onPress={() => handleRemoveBefore(item)}
        >
          <Text style={styles.removeButtonText}>Remove</Text>
        </TouchableOpacity>
      </View>
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
          Weight Before Debonning:{" "}
          {selectedBatch?.weightBefore
            ? selectedBatch.weightBefore.toFixed(3)
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
    <>
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
          <TouchableOpacity
            style={styles.refreshButtonSmall}
            onPress={onRefresh}
          >
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
                style={[
                  styles.deletedRecordItem,
                  { backgroundColor: "#FFF3E0" },
                ]}
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
                    Weight Before Debonning:{" "}
                    {item.weightBefore?.toFixed(3) || "0.000"} kg
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
                  {item.removedFrom && (
                    <Text
                      style={[styles.deletedRecordInfo, { color: "#0066CC" }]}
                    >
                      Removed from: {item.removedFrom}
                    </Text>
                  )}
                </View>
              </View>
            )}
            ListEmptyComponent={
              <Text style={styles.emptyText}>No spoilage removal records</Text>
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
              <Text style={styles.modalTitle}>
                Remove Stock (Before Debonning)
              </Text>
              <Text style={styles.modalSubtitle}>
                Item: {selectedRemovalItem?.carcassType}
              </Text>
              {selectedRemovalItem?.batchCode && (
                <Text style={styles.modalSubtitle}>
                  Batch: {selectedRemovalItem.batchCode}
                </Text>
              )}
              <Text style={styles.modalSubtitle}>
                Received Weight:{" "}
                {selectedRemovalItem?.originalReceivedWeight?.toFixed(3) ||
                  "0.000"}{" "}
                kg
              </Text>
              <Text style={styles.modalSubtitle}>
                Weight Before Debonning:{" "}
                {selectedRemovalItem?.weightBefore?.toFixed(3) || "0.000"} kg
              </Text>
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
                  onPress={confirmRemovalBefore}
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

        <Modal
          animationType="slide"
          transparent={true}
          visible={decisionModalVisible}
          onRequestClose={() => setDecisionModalVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View
              style={[
                styles.modalContent,
                { width: "90%", backgroundColor: "#1a1a2e" },
              ]}
            >
              <Text
                style={[styles.modalTitle, { color: "#4CAF50", fontSize: 22 }]}
              >
                ✅ Weight Captured!
              </Text>
              <View
                style={{
                  borderBottomWidth: 1,
                  borderColor: "#2a2a4a",
                  marginVertical: 12,
                }}
              />
              <Text style={[styles.modalSubtitle, { color: "#fff" }]}>
                Weight: {capturedWeightData?.weight?.toFixed(3)} kg
              </Text>
              <Text style={[styles.modalSubtitle, { color: "#aaa" }]}>
                Batch: {capturedWeightData?.batch?.batchCode}
              </Text>
              <Text style={[styles.modalSubtitle, { color: "#aaa" }]}>
                Carcass: {capturedWeightData?.batch?.carcassType}
              </Text>
              <View
                style={{
                  borderBottomWidth: 1,
                  borderColor: "#2a2a4a",
                  marginVertical: 12,
                }}
              />
              <Text
                style={[
                  styles.modalSubtitle,
                  { color: "#FFA500", textAlign: "center" },
                ]}
              >
                What would you like to do next?
              </Text>

              <TouchableOpacity
                style={[
                  styles.saveButton,
                  {
                    backgroundColor: "#4CAF50",
                    marginTop: 15,
                    paddingVertical: 14,
                  },
                ]}
                onPress={() => handleDecision("packing")}
              >
                <Text style={[styles.saveButtonText, { fontSize: 16 }]}>
                  📦 Go to Meat Packing
                </Text>
                <Text style={{ color: "#fff", fontSize: 12, marginTop: 2 }}>
                  Pack as steaks, ribs, liver, etc.
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.saveButton,
                  {
                    backgroundColor: "#FF6F00",
                    marginTop: 10,
                    paddingVertical: 14,
                  },
                ]}
                onPress={() => handleDecision("processing")}
              >
                <Text style={[styles.saveButtonText, { fontSize: 16 }]}>
                  🌭 Go to Sausage Processing
                </Text>
                <Text style={{ color: "#fff", fontSize: 12, marginTop: 2 }}>
                  Process into sausages with recipes
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </ScrollView>
    </>
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
  const [removalModalVisible, setRemovalModalVisible] = useState(false);
  const [selectedRemovalItem, setSelectedRemovalItem] = useState(null);
  const [removeWeight, setRemoveWeight] = useState("");
  const [removalReason, setRemovalReason] = useState("");

  const [debonningCompleteModalVisible, setDebonningCompleteModalVisible] =
    useState(false);
  const [debonnedRecord, setDebonnedRecord] = useState(null);

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
          type: `${selectedBatch.carcassType}`,
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
          status: "Awaiting Packing",
          carcassType: selectedBatch.carcassType,
        };
        coldStockList.unshift(debonnedRecord);
        await AsyncStorage.setItem(coldStockKey, JSON.stringify(coldStockList));
        for (const item of coldStockList) {
          await syncToFirebase("cold_room_stock", item, businessId);
        }

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

        setDebonnedRecord(debonnedRecord);
        setDebonningCompleteModalVisible(true);
      }
    } catch (error) {
      console.error("Failed to save weight after", error);
      ToastAndroid.show("Error saving weight", ToastAndroid.SHORT);
    }
  };

  const handleRemoveAfter = (item) => {
    setSelectedRemovalItem(item);
    setRemoveWeight("");
    setRemovalReason("");
    setRemovalModalVisible(true);
  };

  const confirmRemovalAfter = async () => {
    const weightToRemove = parseFloat(removeWeight);
    if (isNaN(weightToRemove) || weightToRemove <= 0) {
      ToastAndroid.show("Please enter a valid weight (kg)", ToastAndroid.SHORT);
      return;
    }
    if (weightToRemove > selectedRemovalItem.weightBefore) {
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

    try {
      const coldStockKey = getStockKeyForStore("cold");
      const coldStock = await AsyncStorage.getItem(coldStockKey);
      let coldStockList = coldStock ? JSON.parse(coldStock) : [];

      let idx = coldStockList.findIndex(
        (item) =>
          item.batchCode === selectedRemovalItem.batchCode &&
          item.isDebonned === true,
      );

      if (idx === -1) {
        idx = coldStockList.findIndex(
          (item) =>
            item.batchCode === selectedRemovalItem.batchCode &&
            !item.isDebonned,
        );
      }

      if (idx !== -1) {
        const newWeight = coldStockList[idx].totalWeight - weightToRemove;
        coldStockList[idx].totalWeight = newWeight;
        coldStockList[idx].currentWeight = newWeight;
        coldStockList[idx].lastUpdated = new Date().toISOString();
        coldStockList[idx].removalReason = reason;
        if (newWeight <= 0) {
          coldStockList.splice(idx, 1);
        }
        await AsyncStorage.setItem(coldStockKey, JSON.stringify(coldStockList));

        const businessId = store.getState().settings.BusinessId;
        for (const item of coldStockList) {
          await syncToFirebase("cold_room_stock", item, businessId);
        }

        const spoilageRecord = {
          id: Date.now().toString(),
          batchCode: selectedRemovalItem.batchCode,
          carcassType: selectedRemovalItem.carcassType,
          receivedWeight:
            selectedRemovalItem.originalReceivedWeight ||
            selectedRemovalItem.weightBefore,
          currentWeight: newWeight,
          weightBeforeDebonning: selectedRemovalItem.weightBefore,
          weightRemoved: weightToRemove,
          reason: reason,
          date: new Date().toLocaleString(),
          removedFrom: "Weight After Debonning",
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
        syncToFirebase("spoilageRecords", spoilageRecord, businessId);

        const removalRecord = {
          id: Date.now().toString(),
          store: "cold",
          itemId: selectedRemovalItem.id,
          type: selectedRemovalItem.carcassType,
          weightRemoved: weightToRemove,
          batchCode: selectedRemovalItem.batchCode || "",
          reason: reason,
          date: new Date().toLocaleString(),
          isCarcass: true,
          isColdroom: true,
          isDebonned: true,
          remainingWeight: newWeight,
          removedFrom: "Weight After Debonning",
          weightBeforeDebonning: selectedRemovalItem.weightBefore,
        };

        let removalsList = await AsyncStorage.getItem(REMOVALS_KEY);
        removalsList = removalsList ? JSON.parse(removalsList) : [];
        removalsList.unshift(removalRecord);
        await AsyncStorage.setItem(REMOVALS_KEY, JSON.stringify(removalsList));
        syncToFirebase("stockRemovals", removalRecord, businessId);

        ToastAndroid.show(
          `Removed ${weightToRemove.toFixed(3)} kg from ${selectedRemovalItem.carcassType}`,
          ToastAndroid.LONG,
        );

        setRemovalModalVisible(false);
        setSelectedRemovalItem(null);
        setRemoveWeight("");
        setRemovalReason("");
        onRefresh();
      }
    } catch (error) {
      console.error("Failed to remove stock:", error);
      ToastAndroid.show("Error removing stock", ToastAndroid.SHORT);
    }
  };

  const navigateAfterDebonning = (destination) => {
    setDebonningCompleteModalVisible(false);
    if (destination === "meat_packing") {
      Alert.alert(
        "Meat Packing",
        "The debonned meat is now available in the Packing module under 'Meat' tab.",
        [{ text: "OK", onPress: () => {} }],
      );
    } else if (destination === "sausage_processing") {
      Alert.alert(
        "Sausage Processing",
        "The debonned meat is now available for sausage processing in the Processing module.",
        [{ text: "OK", onPress: () => {} }],
      );
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
          Weight Before Debonning: {item.weightBefore.toFixed(3)} kg
        </Text>
        {item.spoilageRemoved > 0 && (
          <Text style={[styles.stockInfo, { color: "#FF4444" }]}>
            Spoilage Removed: {item.spoilageRemoved.toFixed(3)} kg
          </Text>
        )}
        <Text style={styles.stockDate}>Date: {item.dateBefore}</Text>
      </View>
      <View style={{ flexDirection: "column", gap: 5 }}>
        <TouchableOpacity
          style={[
            styles.removeButton,
            { backgroundColor: "#FFA500", marginBottom: 5 },
          ]}
          onPress={() => startWeighingAfter(item)}
        >
          <Text style={styles.removeButtonText}>Weigh After</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.removeButton, { backgroundColor: "#FF4444" }]}
          onPress={() => handleRemoveAfter(item)}
        >
          <Text style={styles.removeButtonText}>Remove</Text>
        </TouchableOpacity>
      </View>
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
        <TouchableOpacity
          style={[styles.removeButton, { backgroundColor: "#FF4444" }]}
          onPress={() => handleRemoveAfter(item)}
        >
          <Text style={styles.removeButtonText}>Remove</Text>
        </TouchableOpacity>
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
            Capture Weight After Debonning & Save
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <>
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
          <TouchableOpacity
            style={styles.refreshButtonSmall}
            onPress={onRefresh}
          >
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

        <Modal
          animationType="slide"
          transparent
          visible={removalModalVisible}
          onRequestClose={() => setRemovalModalVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>
                Remove Stock (After Debonning)
              </Text>
              <Text style={styles.modalSubtitle}>
                Item: {selectedRemovalItem?.carcassType}
              </Text>
              {selectedRemovalItem?.batchCode && (
                <Text style={styles.modalSubtitle}>
                  Batch: {selectedRemovalItem.batchCode}
                </Text>
              )}
              <Text style={styles.modalSubtitle}>
                Received Weight:{" "}
                {selectedRemovalItem?.originalReceivedWeight?.toFixed(3) ||
                  "0.000"}{" "}
                kg
              </Text>
              <Text style={styles.modalSubtitle}>
                Weight Before Debonning:{" "}
                {selectedRemovalItem?.weightBefore?.toFixed(3) || "0.000"} kg
              </Text>
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
                  onPress={confirmRemovalAfter}
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

      <Modal
        animationType="slide"
        transparent={true}
        visible={debonningCompleteModalVisible}
        onRequestClose={() => setDebonningCompleteModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalContent,
              { width: "90%", backgroundColor: "#1a1a2e" },
            ]}
          >
            <Text
              style={[styles.modalTitle, { color: "#4CAF50", fontSize: 22 }]}
            >
              ✅ Debonning Complete!
            </Text>
            <View
              style={{
                borderBottomWidth: 1,
                borderColor: "#2a2a4a",
                marginVertical: 12,
              }}
            />
            {debonnedRecord && (
              <>
                <Text style={[styles.modalSubtitle, { color: "#fff" }]}>
                  🥩 {debonnedRecord.carcassType || debonnedRecord.type}
                </Text>
                <Text style={[styles.modalSubtitle, { color: "#aaa" }]}>
                  Batch: {debonnedRecord.batchCode}
                </Text>
                <Text style={[styles.modalSubtitle, { color: "#aaa" }]}>
                  Weight After:{" "}
                  {debonnedRecord.weightAfterDebonning?.toFixed(3)} kg
                </Text>
                <Text style={[styles.modalSubtitle, { color: "#aaa" }]}>
                  Variance: {debonnedRecord.variance?.toFixed(3)} kg (
                  {debonnedRecord.variancePercent}%)
                </Text>
              </>
            )}
            <View
              style={{
                borderBottomWidth: 1,
                borderColor: "#2a2a4a",
                marginVertical: 12,
              }}
            />
            <Text
              style={[
                styles.modalSubtitle,
                { color: "#FFA500", textAlign: "center" },
              ]}
            >
              Where would you like to send this meat?
            </Text>

            <TouchableOpacity
              style={[
                styles.saveButton,
                {
                  backgroundColor: "#4CAF50",
                  marginTop: 15,
                  paddingVertical: 14,
                },
              ]}
              onPress={() => navigateAfterDebonning("meat_packing")}
            >
              <Text style={[styles.saveButtonText, { fontSize: 16 }]}>
                📦 Go to Meat Packing
              </Text>
              <Text style={{ color: "#fff", fontSize: 12, marginTop: 2 }}>
                Pack as steaks, ribs, liver, etc.
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.saveButton,
                {
                  backgroundColor: "#FF6F00",
                  marginTop: 10,
                  paddingVertical: 14,
                },
              ]}
              onPress={() => navigateAfterDebonning("sausage_processing")}
            >
              <Text style={[styles.saveButtonText, { fontSize: 16 }]}>
                🌭 Go to Sausage Processing
              </Text>
              <Text style={{ color: "#fff", fontSize: 12, marginTop: 2 }}>
                Process into sausages with recipes
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.saveButton,
                {
                  backgroundColor: "#888",
                  marginTop: 10,
                  paddingVertical: 10,
                },
              ]}
              onPress={() => setDebonningCompleteModalVisible(false)}
            >
              <Text style={[styles.saveButtonText, { fontSize: 14 }]}>
                Stay Here
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
};

// ============ BUTCHERY MAIN SCREEN ============
const ButcheryScreen = ({ onClose }) => {
  const [showWeightBefore, setShowWeightBefore] = useState(false);
  const [showWeightAfter, setShowWeightAfter] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleBatchCreated = (destination) => {
    setRefreshKey((prev) => prev + 1);
    if (destination === "packing") {
      ToastAndroid.show("📦 Opening Packing section...", ToastAndroid.SHORT);
      setShowWeightBefore(false);
      if (onClose) {
        onClose("packing");
      }
    } else if (destination === "processing") {
      ToastAndroid.show("🌭 Opening Processing section...", ToastAndroid.SHORT);
      setShowWeightBefore(false);
      if (onClose) {
        onClose("processing");
      }
    }
  };

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

// ============ GENERIC STORE SCREEN ============
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
      <View style={[styles.deletedRecordItem, { flexDirection: "column" }]}>
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

// ============ DRY GOODS SCREEN ============
const DryGoodsScreen = ({ onClose }) => {
  const [itemDescription, setItemDescription] = useState("");
  const [itemCode, setItemCode] = useState("");
  const [unit, setUnit] = useState("KG");
  const [bomType, setBomType] = useState("");
  const [capturedRecords, setCapturedRecords] = useState([]);
  const [savedSessions, setSavedSessions] = useState([]);
  const [filteredSessions, setFilteredSessions] = useState([]);
  const [searchText, setSearchText] = useState("");
  const [deletedRecords, setDeletedRecords] = useState([]);
  const [filteredDeleted, setFilteredDeleted] = useState([]);
  const [deletedSearchText, setDeletedSearchText] = useState("");
  const [selectedStore] = useState("dry");
  const [stores, setStores] = useState([]);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [restoreModalVisible, setRestoreModalVisible] = useState(false);
  const [recordToRestore, setRecordToRestore] = useState(null);
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
  const [batchNumber, setBatchNumber] = useState("");

  const unitOptions = ["KG", "GM", "PCS"];

  useEffect(() => {
    const loadStores = async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_STORES_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          setStores(parsed);
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
    generateBatchNumber();
  }, []);

  const generateBatchNumber = () => {
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, "");
    const random = Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, "0");
    setBatchNumber(`DRY-${dateStr}-${random}`);
  };

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
            (item.itemCode &&
              item.itemCode.toLowerCase().includes(searchText.toLowerCase())) ||
            (item.description &&
              item.description
                .toLowerCase()
                .includes(searchText.toLowerCase())),
        ),
      );
  }, [searchText, savedSessions]);

  useEffect(() => {
    if (deletedSearchText.trim() === "") setFilteredDeleted(deletedRecords);
    else
      setFilteredDeleted(
        deletedRecords.filter(
          (item) =>
            (item.itemCode &&
              item.itemCode
                .toLowerCase()
                .includes(deletedSearchText.toLowerCase())) ||
            (item.description &&
              item.description
                .toLowerCase()
                .includes(deletedSearchText.toLowerCase())),
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
          `✓ Added item (${weightChange.toFixed(2)} kg)`,
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
          `✓ Removed item (${Math.abs(weightChange).toFixed(2)} kg)`,
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
      ToastAndroid.show("No items to capture", ToastAndroid.SHORT);
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
      `Captured ${pieceCount} items, ${currentWeight.toFixed(2)} kg`,
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
    if (!itemCode.trim()) {
      ToastAndroid.show("Please enter Item Code", ToastAndroid.SHORT);
      return;
    }
    if (!itemDescription.trim()) {
      ToastAndroid.show("Please enter Description", ToastAndroid.SHORT);
      return;
    }
    if (!bomType.trim()) {
      ToastAndroid.show("Please enter BOM Type", ToastAndroid.SHORT);
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
      itemCode: itemCode.trim(),
      description: itemDescription.trim(),
      unit: unit,
      bomType: bomType.trim(),
      batchNumber: batchNumber,
      captures: capturedRecords,
      date: new Date().toLocaleString(),
      totalCaptures: capturedRecords.length,
      totalPieces: totalPieces,
      totalWeight: totalWeightSum,
      store: selectedStore,
      type: "Dry Goods",
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
        (item) => item.itemCode === itemCode.trim(),
      );
      if (existingIndex >= 0) {
        stockList[existingIndex].pieces += totalPieces;
        stockList[existingIndex].totalWeight += totalWeightSum;
        stockList[existingIndex].lastUpdated = new Date().toISOString();
        stockList[existingIndex].batchNumber = batchNumber;
      } else {
        stockList.push({
          id: Date.now().toString(),
          itemCode: itemCode.trim(),
          description: itemDescription.trim(),
          unit: unit,
          bomType: bomType.trim(),
          batchNumber: batchNumber,
          pieces: totalPieces,
          totalWeight: totalWeightSum,
          lastUpdated: new Date().toISOString(),
          type: "Dry Goods",
        });
      }
      await AsyncStorage.setItem(stockKey, JSON.stringify(stockList));
      const businessId = store.getState().settings.BusinessId;
      for (const item of stockList) {
        await syncToFirebase("dry_goods_stock", item, businessId);
      }
      ToastAndroid.show(
        `Dry Goods saved to Dry Goods Store`,
        ToastAndroid.SHORT,
      );
    } catch (error) {
      console.error("Failed to save session", error);
    }
    setItemCode("");
    setItemDescription("");
    setUnit("KG");
    setBomType("");
    setCapturedRecords([]);
    setPieceCount(0);
    previousWeight.current = 0;
    generateBatchNumber();
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
      itemCode: session.itemCode || "",
      description: session.description || "",
      batchNumber: session.batchNumber || "",
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
      const index = stockList.findIndex(
        (item) => item.itemCode === session.itemCode,
      );
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

  const restoreDeletedSession = async () => {
    if (!recordToRestore) return;

    try {
      const stockKey = getStockKeyForStore(recordToRestore.store || "dry");
      const stock = await AsyncStorage.getItem(stockKey);
      let stockList = stock ? JSON.parse(stock) : [];

      const existingIndex = stockList.findIndex(
        (item) => item.itemCode === recordToRestore.itemCode,
      );

      if (existingIndex >= 0) {
        stockList[existingIndex].pieces += recordToRestore.totalPieces;
        stockList[existingIndex].totalWeight += recordToRestore.totalWeight;
        stockList[existingIndex].lastUpdated = new Date().toISOString();
      } else {
        stockList.push({
          id: Date.now().toString(),
          itemCode: recordToRestore.itemCode,
          description: recordToRestore.description,
          unit: recordToRestore.unit || "KG",
          bomType: recordToRestore.bomType || "",
          batchNumber: recordToRestore.batchNumber || "",
          pieces: recordToRestore.totalPieces,
          totalWeight: recordToRestore.totalWeight,
          lastUpdated: new Date().toISOString(),
          type: "Dry Goods",
        });
      }

      await AsyncStorage.setItem(stockKey, JSON.stringify(stockList));

      const restoredSession = {
        id: recordToRestore.sessionId,
        itemCode: recordToRestore.itemCode,
        description: recordToRestore.description,
        unit: recordToRestore.unit || "KG",
        bomType: recordToRestore.bomType || "",
        batchNumber: recordToRestore.batchNumber || "",
        captures: recordToRestore.captures || [],
        date: recordToRestore.originalDate,
        totalCaptures: (recordToRestore.captures || []).length,
        totalPieces: recordToRestore.totalPieces,
        totalWeight: recordToRestore.totalWeight,
        store: recordToRestore.store || "dry",
        type: "Dry Goods",
      };

      const updatedSessions = [restoredSession, ...savedSessions];
      setSavedSessions(updatedSessions);
      await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify(updatedSessions));

      const updatedDeletions = deletedRecords.filter(
        (r) => r.id !== recordToRestore.id,
      );
      setDeletedRecords(updatedDeletions);
      await AsyncStorage.setItem(
        DRY_GOODS_DELETIONS_KEY,
        JSON.stringify(updatedDeletions),
      );

      ToastAndroid.show(
        `Restored ${recordToRestore.description} (${recordToRestore.totalPieces} pieces, ${recordToRestore.totalWeight.toFixed(2)} kg) to stock`,
        ToastAndroid.LONG,
      );

      setRestoreModalVisible(false);
      setRecordToRestore(null);
      onRefresh();
    } catch (error) {
      console.error("Failed to restore session:", error);
      ToastAndroid.show("Error restoring session", ToastAndroid.SHORT);
    }
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
          <Text style={styles.sessionType}>Item: {item.itemCode}</Text>
          <Text style={styles.sessionInfo}>
            {item.description} - {item.unit}
          </Text>
          <Text style={styles.sessionInfo}>
            BOM: {item.bomType} | Batch: {item.batchNumber}
          </Text>
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
      <View style={[styles.deletedRecordItem, { flexDirection: "column" }]}>
        <View style={styles.deletedRecordDetails}>
          <Text style={styles.deletedRecordType}>
            Item: {item.itemCode} - {item.description}
          </Text>
          <Text style={styles.deletedRecordInfo}>
            {item.totalPieces || 0} pieces |{" "}
            {(item.totalWeight || 0).toFixed(2)} kg
          </Text>
          <Text style={styles.deletedRecordInfo}>
            BOM: {item.bomType} | Batch: {item.batchNumber}
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
        <TouchableOpacity
          style={[
            styles.removeButton,
            { backgroundColor: "#4CAF50", marginTop: 8 },
          ]}
          onPress={() => {
            setRecordToRestore(item);
            setRestoreModalVisible(true);
          }}
        >
          <Text style={styles.removeButtonText}>Restore</Text>
        </TouchableOpacity>
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
          <View style={styles.hardcodedContainer}>
            <Text style={styles.hardcodedLabel}>Store:</Text>
            <View style={styles.hardcodedValue}>
              <Text style={styles.hardcodedText}>Dry Goods Store</Text>
            </View>
          </View>

          <View style={styles.hardcodedContainer}>
            <Text style={styles.hardcodedLabel}>Item Type:</Text>
            <View style={styles.hardcodedValue}>
              <Text style={styles.hardcodedText}>Dry Goods</Text>
            </View>
          </View>

          <View style={styles.hardcodedContainer}>
            <Text style={styles.hardcodedLabel}>Batch Number:</Text>
            <View style={styles.hardcodedValue}>
              <Text style={styles.hardcodedText}>{batchNumber}</Text>
            </View>
          </View>

          <TextInput
            style={styles.inputField}
            placeholder="Item Code (e.g., PROC0013)"
            value={itemCode}
            onChangeText={setItemCode}
          />

          <TextInput
            style={styles.inputField}
            placeholder="Description (e.g., Cooking Oil)"
            value={itemDescription}
            onChangeText={setItemDescription}
          />

          <Text style={styles.label}>Unit:</Text>
          <View style={styles.unitContainer}>
            {unitOptions.map((u) => (
              <TouchableOpacity
                key={u}
                style={[styles.unitBtn, unit === u && styles.unitBtnActive]}
                onPress={() => setUnit(u)}
              >
                <Text
                  style={[
                    styles.unitBtnText,
                    unit === u && styles.unitBtnTextActive,
                  ]}
                >
                  {u}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <TextInput
            style={styles.inputField}
            placeholder="BOM Type (e.g., A or S)"
            value={bomType}
            onChangeText={setBomType}
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
            placeholder="Search by Item Code or Description..."
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
            placeholder="Search by Item Code or Description..."
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
                  Item: {sessionToDelete.itemCode} -{" "}
                  {sessionToDelete.description}
                </Text>
                <Text style={styles.modalSubtitle}>
                  {sessionToDelete.totalPieces || 0} pieces |{" "}
                  {(sessionToDelete.totalWeight || 0).toFixed(2)} kg
                </Text>
                <Text style={styles.modalSubtitle}>
                  BOM: {sessionToDelete.bomType} | Batch:{" "}
                  {sessionToDelete.batchNumber}
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

      <Modal
        animationType="slide"
        transparent
        visible={restoreModalVisible}
        onRequestClose={() => setRestoreModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Restore Session</Text>
            {recordToRestore && (
              <>
                <Text style={styles.modalSubtitle}>
                  Item: {recordToRestore.itemCode} -{" "}
                  {recordToRestore.description}
                </Text>
                <Text style={styles.modalSubtitle}>
                  {recordToRestore.totalPieces || 0} pieces |{" "}
                  {(recordToRestore.totalWeight || 0).toFixed(2)} kg
                </Text>
                <Text style={styles.modalSubtitle}>
                  BOM: {recordToRestore.bomType} | Batch:{" "}
                  {recordToRestore.batchNumber}
                </Text>
                <Text style={styles.modalSubtitle}>
                  Store:{" "}
                  {stores.find((s) => s.value === recordToRestore.store)
                    ?.label || recordToRestore.store}
                </Text>
              </>
            )}
            <Text
              style={[
                styles.modalSubtitle,
                { marginTop: 12, color: "#4CAF50" },
              ]}
            >
              Are you sure you want to restore this session to stock?
            </Text>
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: "#4CAF50" }]}
                onPress={restoreDeletedSession}
              >
                <Text style={styles.modalButtonText}>Restore</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: "#888" }]}
                onPress={() => {
                  setRestoreModalVisible(false);
                  setRecordToRestore(null);
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

// ============ STORAGE SCREEN WITH CORRECT DRY GOODS DISPLAY ============
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
  const [weightBeforeDebonningRecords, setWeightBeforeDebonningRecords] =
    useState([]);
  const [filteredWeightBefore, setFilteredWeightBefore] = useState([]);
  const [weightBeforeSearchText, setWeightBeforeSearchText] = useState("");
  const [usedStockRecords, setUsedStockRecords] = useState([]);
  const [filteredUsedStock, setFilteredUsedStock] = useState([]);
  const [usedStockSearchText, setUsedStockSearchText] = useState("");
  const [removalModalVisible, setRemovalModalVisible] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [removeWeight, setRemoveWeight] = useState("");
  const [removalReason, setRemovalReason] = useState("");
  const [stores, setStores] = useState([]);
  const [manageStoresVisible, setManageStoresVisible] = useState(false);
  const [newStoreName, setNewStoreName] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [returnModalVisible, setReturnModalVisible] = useState(false);
  const [selectedReturnItem, setSelectedReturnItem] = useState(null);
  const [returnReason, setReturnReason] = useState("");
  const [returnedRecords, setReturnedRecords] = useState([]);
  const [filteredReturned, setFilteredReturned] = useState([]);
  const [returnedSearchText, setReturnedSearchText] = useState("");

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
    loadReturnedRecords();
  }, []);

  const loadReturnedRecords = async () => {
    try {
      const stored = await AsyncStorage.getItem(RETURNED_RECORDS_KEY);
      if (stored) {
        const records = JSON.parse(stored);
        setReturnedRecords(records);
        setFilteredReturned(records);
      }
    } catch (error) {
      console.error("Failed to load returned records:", error);
    }
  };

  useEffect(() => {
    if (stores.length > 0) {
      AsyncStorage.setItem(STORAGE_STORES_KEY, JSON.stringify(stores)).catch(
        console.error,
      );
      if (onStoreCreated) onStoreCreated(stores);
    }
  }, [stores, onStoreCreated]);

  useEffect(() => {
    if (returnedSearchText.trim() === "") {
      setFilteredReturned(returnedRecords);
    } else {
      setFilteredReturned(
        returnedRecords.filter(
          (record) =>
            (record.batchCode &&
              record.batchCode
                .slice(-3)
                .toLowerCase()
                .includes(returnedSearchText.toLowerCase())) ||
            (record.type &&
              record.type
                .toLowerCase()
                .includes(returnedSearchText.toLowerCase())),
        ),
      );
    }
  }, [returnedSearchText, returnedRecords]);

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

  const loadUsedStockRecords = async () => {
    try {
      const stored = await AsyncStorage.getItem(USED_STOCK_KEY);
      if (stored) {
        const records = JSON.parse(stored);
        const dryGoodsUsed = records.filter(
          (record) => record.dryGoodsUsed && record.dryGoodsUsed.length > 0,
        );
        setUsedStockRecords(dryGoodsUsed);
        setFilteredUsedStock(dryGoodsUsed);
      } else {
        setUsedStockRecords([]);
        setFilteredUsedStock([]);
      }
    } catch (error) {
      console.error("Failed to load used stock records:", error);
      setUsedStockRecords([]);
      setFilteredUsedStock([]);
    }
  };

  const loadWeightBeforeDebonningRecords = async () => {
    try {
      const stored = await AsyncStorage.getItem(WEIGHT_BEFORE_DEBONNING_KEY);
      if (stored) {
        const records = JSON.parse(stored);
        const pendingRecords = records.filter(
          (record) =>
            record.status === "pending" || record.status === "weighed",
        );
        const sorted = pendingRecords.sort(
          (a, b) => new Date(b.dateBefore) - new Date(a.dateBefore),
        );
        setWeightBeforeDebonningRecords(sorted);
        setFilteredWeightBefore(sorted);
      } else {
        setWeightBeforeDebonningRecords([]);
        setFilteredWeightBefore([]);
      }
    } catch (error) {
      console.error("Failed to load weight before debonning records:", error);
      setWeightBeforeDebonningRecords([]);
      setFilteredWeightBefore([]);
    }
  };

  useEffect(() => {
    if (stockSearchText.trim() === "") setFilteredStock(stock);
    else
      setFilteredStock(
        stock.filter(
          (item) =>
            (item.batchCode &&
              item.batchCode
                .slice(-3)
                .toLowerCase()
                .includes(stockSearchText.toLowerCase())) ||
            (item.itemCode &&
              item.itemCode
                .toLowerCase()
                .includes(stockSearchText.toLowerCase())) ||
            (item.description &&
              item.description
                .toLowerCase()
                .includes(stockSearchText.toLowerCase())) ||
            (item.type &&
              item.type
                .toLowerCase()
                .includes(stockSearchText.toLowerCase())) ||
            (item.carcassType &&
              item.carcassType
                .toLowerCase()
                .includes(stockSearchText.toLowerCase())),
        ),
      );
  }, [stockSearchText, stock]);

  useEffect(() => {
    if (debonnedSearchText.trim() === "") setFilteredDebonned(debonnedStock);
    else
      setFilteredDebonned(
        debonnedStock.filter(
          (item) =>
            (item.batchCode &&
              item.batchCode
                .slice(-3)
                .toLowerCase()
                .includes(debonnedSearchText.toLowerCase())) ||
            (item.type &&
              item.type
                .toLowerCase()
                .includes(debonnedSearchText.toLowerCase())) ||
            (item.carcassType &&
              item.carcassType
                .toLowerCase()
                .includes(debonnedSearchText.toLowerCase())),
        ),
      );
  }, [debonnedSearchText, debonnedStock]);

  useEffect(() => {
    if (weightBeforeSearchText.trim() === "")
      setFilteredWeightBefore(weightBeforeDebonningRecords);
    else
      setFilteredWeightBefore(
        weightBeforeDebonningRecords.filter(
          (item) =>
            (item.batchCode &&
              item.batchCode
                .slice(-3)
                .toLowerCase()
                .includes(weightBeforeSearchText.toLowerCase())) ||
            (item.carcassType &&
              item.carcassType
                .toLowerCase()
                .includes(weightBeforeSearchText.toLowerCase())),
        ),
      );
  }, [weightBeforeSearchText, weightBeforeDebonningRecords]);

  useEffect(() => {
    if (usedStockSearchText.trim() === "")
      setFilteredUsedStock(usedStockRecords);
    else
      setFilteredUsedStock(
        usedStockRecords.filter(
          (record) =>
            record.productName
              ?.toLowerCase()
              .includes(usedStockSearchText.toLowerCase()) ||
            record.batchCode
              ?.toLowerCase()
              .includes(usedStockSearchText.toLowerCase()),
        ),
      );
  }, [usedStockSearchText, usedStockRecords]);

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
    if (storeValue === "cold") {
      loadWeightBeforeDebonningRecords();
    } else if (storeValue === "dry") {
      loadUsedStockRecords();
    }
    setStockSearchText("");
    setDebonnedSearchText("");
    setRemovalsSearchText("");
    setWeightBeforeSearchText("");
    setUsedStockSearchText("");
    setReturnedSearchText("");
  };

  const onRefresh = async () => {
    if (selectedStore) {
      setRefreshing(true);
      await Promise.all([
        loadStock(selectedStore),
        loadRemovals(selectedStore),
        selectedStore === "cold"
          ? loadWeightBeforeDebonningRecords()
          : Promise.resolve(),
        selectedStore === "dry" ? loadUsedStockRecords() : Promise.resolve(),
        loadReturnedRecords(),
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
      const oldTotalWeight = selectedItem.totalWeight;
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
            carcassType: selectedItem.type || selectedItem.carcassType,
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
        type: selectedItem.type || selectedItem.carcassType,
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
      const businessId = store.getState().settings.BusinessId;
      const collectionName =
        selectedStore === "cold" ? "cold_room_stock" : "dry_goods_stock";
      for (const item of allStock) {
        await syncToFirebase(collectionName, item, businessId);
      }
      loadRemovals(selectedStore);
      ToastAndroid.show(
        `Removed ${weightToRemove.toFixed(3)} kg from ${selectedItem.type || selectedItem.carcassType}. Remaining: ${newTotalWeight.toFixed(3)} kg`,
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
        const businessId = store.getState().settings.BusinessId;
        const collectionName =
          selectedStore === "cold" ? "cold_room_stock" : "dry_goods_stock";
        for (const item of updatedStock) {
          await syncToFirebase(collectionName, item, businessId);
        }
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

  const handleReturn = (item) => {
    setSelectedReturnItem(item);
    setReturnReason("");
    setReturnModalVisible(true);
  };

  const confirmReturn = async () => {
    if (!selectedReturnItem) return;

    const reason = returnReason.trim();
    if (reason === "") {
      ToastAndroid.show(
        "Please enter a reason for returning",
        ToastAndroid.SHORT,
      );
      return;
    }

    try {
      const stockKey = getStockKeyForStore(selectedStore);
      const stock = await AsyncStorage.getItem(stockKey);
      let stockList = stock ? JSON.parse(stock) : [];

      // Find the item in the removals list by matching id
      const removalIndex = removals.findIndex(
        (r) => r.id === selectedReturnItem.id,
      );
      if (removalIndex === -1) {
        ToastAndroid.show("Item not found in removals", ToastAndroid.SHORT);
        return;
      }

      const removal = removals[removalIndex];

      // Check if item already exists in stock by matching batchCode and type
      const existingIndex = stockList.findIndex(
        (item) =>
          item.batchCode &&
          item.batchCode === removal.batchCode &&
          item.type === removal.type &&
          !item.isDebonned,
      );

      if (existingIndex !== -1) {
        // Update existing stock
        stockList[existingIndex].totalWeight =
          (stockList[existingIndex].totalWeight || 0) + removal.weightRemoved;
        stockList[existingIndex].currentWeight =
          (stockList[existingIndex].currentWeight || 0) + removal.weightRemoved;
        stockList[existingIndex].lastUpdated = new Date().toISOString();
        stockList[existingIndex].status = "Returned";
        stockList[existingIndex].returnReason = reason;
        stockList[existingIndex].returnedAt = new Date().toISOString();
      } else {
        // Create new stock entry
        const newItem = {
          id: Date.now().toString(),
          type: removal.type || selectedReturnItem.type,
          batchCode: removal.batchCode || selectedReturnItem.batchCode,
          totalWeight: removal.weightRemoved,
          currentWeight: removal.weightRemoved,
          lastUpdated: new Date().toISOString(),
          status: "Returned",
          returnReason: reason,
          returnedAt: new Date().toISOString(),
          isDebonned: removal.isDebonned || false,
          originalReceivedWeight: removal.weightRemoved,
          pieces: selectedReturnItem.pieces || 1,
          carcassType: removal.type || selectedReturnItem.type,
          itemCode: selectedReturnItem.itemCode || "",
          description: selectedReturnItem.description || "",
          unit: selectedReturnItem.unit || "KG",
          bomType: selectedReturnItem.bomType || "",
          batchNumber: selectedReturnItem.batchNumber || "",
        };
        stockList.push(newItem);
      }

      await AsyncStorage.setItem(stockKey, JSON.stringify(stockList));

      // Remove from removals
      const updatedRemovals = removals.filter(
        (_, index) => index !== removalIndex,
      );
      setRemovals(updatedRemovals);
      setFilteredRemovals(updatedRemovals);
      await AsyncStorage.setItem(REMOVALS_KEY, JSON.stringify(updatedRemovals));

      // Record the return
      const returnRecord = {
        id: Date.now().toString(),
        batchCode: removal.batchCode || selectedReturnItem.batchCode,
        type: removal.type || selectedReturnItem.type,
        weightReturned: removal.weightRemoved,
        reason: reason,
        date: new Date().toLocaleString(),
        store: selectedStore,
        isDebonned: removal.isDebonned || false,
        returnedFrom: "Deleted Records",
      };

      const returnedStored = await AsyncStorage.getItem(RETURNED_RECORDS_KEY);
      let returnedList = returnedStored ? JSON.parse(returnedStored) : [];
      returnedList.unshift(returnRecord);
      await AsyncStorage.setItem(
        RETURNED_RECORDS_KEY,
        JSON.stringify(returnedList),
      );
      setReturnedRecords(returnedList);
      setFilteredReturned(returnedList);

      ToastAndroid.show(
        `✅ Returned ${removal.weightRemoved.toFixed(3)} kg of ${removal.type} to stock`,
        ToastAndroid.LONG,
      );

      setReturnModalVisible(false);
      setSelectedReturnItem(null);
      setReturnReason("");
      onRefresh();
    } catch (error) {
      console.error("Failed to return stock:", error);
      ToastAndroid.show("Error returning stock", ToastAndroid.SHORT);
    }
  };

  if (selectedStore) {
    const storeLabel =
      stores.find((s) => s.value === selectedStore)?.label || selectedStore;
    const isColdroom = selectedStore === "cold";
    const isDryGoods = selectedStore === "dry";
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

          {/* ====== STOCK IN-STORE ====== */}
          <Text style={styles.sectionHeader}>
            {isDryGoods
              ? "📦 Dry Goods In-Stock"
              : isColdroom
                ? "🐄 First Weight Carcasses In-Stock"
                : `📦 ${storeLabel} In-Stock`}
          </Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search by batch, item code, or description..."
            value={stockSearchText}
            onChangeText={setStockSearchText}
          />
          <FlatList
            data={filteredStock}
            keyExtractor={(item, index) => item.id + index.toString()}
            renderItem={({ item }) => (
              <View style={styles.stockItem}>
                <View style={styles.stockDetails}>
                  <Text style={styles.stockType}>
                    {item.carcassType ||
                      item.type ||
                      item.itemCode ||
                      item.description ||
                      "Unknown"}
                  </Text>
                  {item.description && !item.carcassType && (
                    <Text style={styles.stockInfo}>
                      Description: {item.description}
                    </Text>
                  )}
                  {item.batchCode && (
                    <Text style={styles.stockInfo}>
                      Batch No: {item.batchCode}
                    </Text>
                  )}
                  {item.batchNumber && (
                    <Text style={styles.stockInfo}>
                      Batch #: {item.batchNumber}
                    </Text>
                  )}
                  <Text style={styles.stockInfo}>
                    Unit: {item.unit || "KG"}
                  </Text>
                  {item.bomType && (
                    <Text style={styles.stockInfo}>
                      BOM Type: {item.bomType}
                    </Text>
                  )}
                  <Text style={styles.stockInfo}>
                    Received Weight:{" "}
                    {item.originalReceivedWeight
                      ? item.originalReceivedWeight.toFixed(3)
                      : item.totalWeight?.toFixed(3) || "0.000"}{" "}
                    kg
                  </Text>

                  {isColdroom && (
                    <>
                      <Text style={styles.stockInfo}>
                        Weight Before Debonning:{" "}
                        {item.weightBefore?.toFixed(3) || "0.000"} kg
                      </Text>
                      <Text style={styles.stockInfo}>
                        Weight After Debonning:{" "}
                        {item.weightAfterDebonning?.toFixed(3) || "0.000"} kg
                      </Text>
                    </>
                  )}

                  <Text style={styles.stockInfo}>
                    Pieces: {item.pieces || 0}
                  </Text>
                  <Text style={styles.stockInfo}>
                    Reason for removal: {item.removalReason || "N/A"}
                  </Text>
                  <Text style={styles.stockDate}>
                    Last updated:{" "}
                    {item.lastUpdated
                      ? new Date(item.lastUpdated).toLocaleString()
                      : "N/A"}
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
              <Text style={styles.emptyText}>
                No stock available in {storeLabel}.
                {selectedStore === "dry"
                  ? "\nAdd items via 'Dry Goods' screen."
                  : "\nAdd items via 'Carcasses' screen."}
              </Text>
            }
            scrollEnabled={false}
          />

          {/* ====== USED DRY GOODS SECTION (Dry Goods Only) ====== */}
          {isDryGoods && (
            <>
              <Text
                style={[
                  styles.sectionHeader,
                  { marginTop: 20, color: "#FF6F00" },
                ]}
              >
                📦 Used Dry Goods (Consumed in Processing)
              </Text>
              <TextInput
                style={styles.searchInput}
                placeholder="Search by product or batch..."
                value={usedStockSearchText}
                onChangeText={setUsedStockSearchText}
              />
              <FlatList
                data={filteredUsedStock}
                keyExtractor={(item, index) => item.id + index.toString()}
                renderItem={({ item }) => (
                  <View
                    style={[
                      styles.stockItem,
                      {
                        backgroundColor: "#FFF8E1",
                        flexDirection: "column",
                        alignItems: "stretch",
                      },
                    ]}
                  >
                    <View style={styles.stockDetails}>
                      <Text style={styles.stockType}>
                        Product: {item.productName}
                      </Text>
                      <Text style={styles.stockInfo}>
                        Batch: {item.batchCode}
                      </Text>
                      <Text style={styles.stockInfo}>
                        Total Pieces: {item.totalPieces}
                      </Text>
                      <Text style={styles.stockInfo}>Date: {item.date}</Text>
                      {item.dryGoodsUsed && item.dryGoodsUsed.length > 0 && (
                        <>
                          <Text
                            style={[
                              styles.stockInfo,
                              {
                                fontWeight: "bold",
                                marginTop: 4,
                                color: "#0066CC",
                              },
                            ]}
                          >
                            📦 Dry Goods Consumed:
                          </Text>
                          {item.dryGoodsUsed.map((d, idx) => (
                            <Text
                              key={idx}
                              style={[
                                styles.stockInfo,
                                { marginLeft: 8, fontSize: 12 },
                              ]}
                            >
                              • {d.description || d.itemCode}:
                              <Text style={{ fontWeight: "bold" }}>
                                {" "}
                                {d.amountUsed.toFixed(3)} kg
                              </Text>{" "}
                              used
                              {d.remainingWeight !== undefined && (
                                <Text
                                  style={{
                                    color:
                                      d.remainingWeight > 0
                                        ? "#2E7D32"
                                        : "#C62828",
                                  }}
                                >
                                  {" "}
                                  (Balance: {d.remainingWeight.toFixed(3)} kg)
                                </Text>
                              )}
                            </Text>
                          ))}
                        </>
                      )}
                    </View>
                  </View>
                )}
                ListEmptyComponent={
                  <Text style={styles.emptyText}>
                    No dry goods have been used in processing yet.
                  </Text>
                }
                scrollEnabled={false}
              />
            </>
          )}

          {/* ====== WEIGHT BEFORE DEBONNING RECORDS (Coldroom Only) ====== */}
          {isColdroom && (
            <>
              <Text
                style={[
                  styles.sectionHeader,
                  { marginTop: 20, color: "#FF6F00" },
                ]}
              >
                ⚖️ Weight Before Debonning Records
              </Text>
              <TextInput
                style={styles.searchInput}
                placeholder="Search by batch or carcass type..."
                value={weightBeforeSearchText}
                onChangeText={setWeightBeforeSearchText}
              />
              <FlatList
                data={filteredWeightBefore}
                keyExtractor={(item, index) => item.id + index.toString()}
                renderItem={({ item }) => {
                  const hasWeight = item.weightBefore && item.weightBefore > 0;
                  return (
                    <View
                      style={[
                        styles.stockItem,
                        { backgroundColor: hasWeight ? "#E8F5E9" : "#FFF3E0" },
                      ]}
                    >
                      <View style={styles.stockDetails}>
                        <Text style={styles.stockType}>
                          {item.carcassType || "Carcass"}
                        </Text>
                        <Text style={styles.stockInfo}>
                          Batch No: {item.batchCode}
                        </Text>
                        <Text style={styles.stockInfo}>
                          Received Weight:{" "}
                          {item.originalReceivedWeight?.toFixed(3) || "0.000"}{" "}
                          kg
                        </Text>
                        <Text
                          style={[
                            styles.stockInfo,
                            {
                              fontWeight: "bold",
                              color: hasWeight ? "#2E7D32" : "#FF6F00",
                            },
                          ]}
                        >
                          Weight Before Debonning:{" "}
                          {item.weightBefore?.toFixed(3) || "0.000"} kg
                          {!hasWeight && " ⏳ Awaiting weighing"}
                          {hasWeight && " ✅ Captured"}
                        </Text>
                        {item.spoilageRemoved > 0 && (
                          <Text
                            style={[styles.stockInfo, { color: "#FF4444" }]}
                          >
                            Spoilage Removed: {item.spoilageRemoved.toFixed(3)}{" "}
                            kg
                          </Text>
                        )}
                        <Text style={styles.stockInfo}>
                          Pieces: {item.pieces || 1}
                        </Text>
                        <Text style={styles.stockInfo}>
                          Status:{" "}
                          {item.status === "pending"
                            ? "⏳ Pending"
                            : item.status === "weighed"
                              ? "⚖️ Weighed"
                              : "✅ Completed"}
                        </Text>
                        <Text style={styles.stockDate}>
                          Date: {item.dateBefore || "N/A"}
                          {item.dateWeighed &&
                            ` | Weighed: ${item.dateWeighed}`}
                        </Text>
                      </View>
                      {!hasWeight && (
                        <View
                          style={[
                            styles.removeButton,
                            {
                              backgroundColor: "#FFA500",
                              paddingHorizontal: 6,
                            },
                          ]}
                        >
                          <Text
                            style={[styles.removeButtonText, { fontSize: 9 }]}
                          >
                            Pending
                          </Text>
                        </View>
                      )}
                      {hasWeight && (
                        <View
                          style={[
                            styles.removeButton,
                            {
                              backgroundColor: "#4CAF50",
                              paddingHorizontal: 6,
                            },
                          ]}
                        >
                          <Text
                            style={[styles.removeButtonText, { fontSize: 9 }]}
                          >
                            Done
                          </Text>
                        </View>
                      )}
                    </View>
                  );
                }}
                ListEmptyComponent={
                  <Text style={styles.emptyText}>
                    No weight before debonning records found
                  </Text>
                }
                scrollEnabled={false}
              />
            </>
          )}

          {/* ====== AFTER DEBONNING WEIGHT RECORDS (Coldroom Only) ====== */}
          {isColdroom && (
            <>
              <Text
                style={[
                  styles.sectionHeader,
                  { marginTop: 20, color: "#4CAF50" },
                ]}
              >
                🥩 After Debonning Weight Records
              </Text>
              <TextInput
                style={styles.searchInput}
                placeholder="Search by last 3 digits of batch no..."
                value={debonnedSearchText}
                onChangeText={setDebonnedSearchText}
              />
              <FlatList
                data={filteredDebonned}
                keyExtractor={(item, index) => item.id + index.toString()}
                renderItem={({ item }) => {
                  const varianceColor =
                    item.variance >= 0 ? "#4CAF50" : "#FF4444";
                  const varianceSign = item.variance >= 0 ? "+" : "";
                  const weightAfterDebonningDisplay =
                    item.weightAfterDebonning || item.totalWeight;
                  return (
                    <View
                      style={[styles.stockItem, { backgroundColor: "#E8F5E9" }]}
                    >
                      <View style={styles.stockDetails}>
                        <Text style={styles.stockType}>
                          {item.type || item.carcassType || "Unknown"}
                        </Text>
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
                          {weightAfterDebonningDisplay?.toFixed(3) || "0.000"}{" "}
                          kg
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

          {/* ====== DELETED RECORDS ====== */}
          <Text style={[styles.recordsHeader, { marginTop: 20 }]}>
            🗑️ Deleted Records
          </Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search by last 3 digits of batch no..."
            value={removalsSearchText}
            onChangeText={setRemovalsSearchText}
          />
          <FlatList
            data={filteredRemovals}
            keyExtractor={(item, index) => item.id + index.toString()}
            renderItem={({ item }) => (
              <View
                style={[styles.deletedRecordItem, { flexDirection: "column" }]}
              >
                <View style={styles.deletedRecordDetails}>
                  <Text style={styles.deletedRecordType}>
                    {item.type || item.carcassType}
                  </Text>
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
                <TouchableOpacity
                  style={[
                    styles.removeButton,
                    {
                      backgroundColor: "#4CAF50",
                      marginTop: 8,
                      alignSelf: "flex-start",
                    },
                  ]}
                  onPress={() => handleReturn(item)}
                >
                  <Text style={styles.removeButtonText}>Return to Stock</Text>
                </TouchableOpacity>
              </View>
            )}
            ListEmptyComponent={
              <Text style={styles.emptyText}>No deletion records found</Text>
            }
            scrollEnabled={false}
          />

          {/* ====== RETURNED RECORDS ====== */}
          <Text
            style={[styles.recordsHeader, { marginTop: 20, color: "#4CAF50" }]}
          >
            🔄 Returned Records
          </Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search by batch or type..."
            value={returnedSearchText}
            onChangeText={setReturnedSearchText}
          />
          <FlatList
            data={filteredReturned}
            keyExtractor={(item, index) => item.id + index.toString()}
            renderItem={({ item }) => (
              <View
                style={[
                  styles.deletedRecordItem,
                  { backgroundColor: "#E8F5E9", flexDirection: "column" },
                ]}
              >
                <View style={styles.deletedRecordDetails}>
                  <Text
                    style={[styles.deletedRecordType, { color: "#2E7D32" }]}
                  >
                    {item.type || "Item"}
                  </Text>
                  {item.batchCode && (
                    <Text style={styles.deletedRecordInfo}>
                      Batch: {item.batchCode}
                    </Text>
                  )}
                  <Text style={styles.deletedRecordInfo}>
                    Weight Returned:{" "}
                    {item.weightReturned?.toFixed(3) || "0.000"} kg
                  </Text>
                  <Text style={styles.deletedRecordInfo}>
                    Reason: {item.reason || "N/A"}
                  </Text>
                  <Text style={styles.deletedRecordDate}>
                    Returned: {item.date || new Date().toLocaleString()}
                  </Text>
                  {item.returnedFrom && (
                    <Text
                      style={[styles.deletedRecordInfo, { color: "#0066CC" }]}
                    >
                      Returned from: {item.returnedFrom}
                    </Text>
                  )}
                </View>
              </View>
            )}
            ListEmptyComponent={
              <Text style={styles.emptyText}>No returned records found</Text>
            }
            scrollEnabled={false}
          />
        </View>

        {/* Removal Modal */}
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
                Item:{" "}
                {selectedItem?.type ||
                  selectedItem?.carcassType ||
                  selectedItem?.itemCode ||
                  selectedItem?.description ||
                  "Unknown"}
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
              {isColdroom && (
                <>
                  <Text style={styles.modalSubtitle}>
                    Weight Before Debonning:{" "}
                    {selectedItem?.weightBefore?.toFixed(3) || "0.000"} kg
                  </Text>
                  <Text style={styles.modalSubtitle}>
                    Weight After Debonning:{" "}
                    {selectedItem?.weightAfterDebonning?.toFixed(3) || "0.000"}{" "}
                    kg
                  </Text>
                </>
              )}
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

        {/* Return Modal */}
        <Modal
          animationType="slide"
          transparent
          visible={returnModalVisible}
          onRequestClose={() => setReturnModalVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={[styles.modalTitle, { color: "#4CAF50" }]}>
                Return Stock
              </Text>
              <Text style={styles.modalSubtitle}>
                Item:{" "}
                {selectedReturnItem?.type ||
                  selectedReturnItem?.carcassType ||
                  "Unknown"}
              </Text>
              {selectedReturnItem?.batchCode && (
                <Text style={styles.modalSubtitle}>
                  Batch: {selectedReturnItem.batchCode}
                </Text>
              )}
              <Text style={styles.modalSubtitle}>
                Weight to Return:{" "}
                {selectedReturnItem?.weightRemoved?.toFixed(3) || "0.000"} kg
              </Text>
              <Text
                style={[
                  styles.modalSubtitle,
                  { marginTop: 12, color: "#FF6F00" },
                ]}
              >
                Please provide a reason for returning this stock.
              </Text>
              <TextInput
                style={[styles.inputField, { marginTop: 10 }]}
                placeholder="Reason for return (required)"
                value={returnReason}
                onChangeText={setReturnReason}
                multiline
                numberOfLines={3}
              />
              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={[styles.modalButton, { backgroundColor: "#4CAF50" }]}
                  onPress={confirmReturn}
                >
                  <Text style={styles.modalButtonText}>Confirm Return</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalButton, { backgroundColor: "#888" }]}
                  onPress={() => {
                    setReturnModalVisible(false);
                    setSelectedReturnItem(null);
                    setReturnReason("");
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

// ============ CARCASSES SCREEN ============
const CarcassesScreen = ({ onClose }) => {
  const [carcassType, setCarcassType] = useState("");
  const [itemCode, setItemCode] = useState("");
  const [unit, setUnit] = useState("KG");
  const [bomType, setBomType] = useState("");
  const [capturedRecords, setCapturedRecords] = useState([]);
  const [savedSessions, setSavedSessions] = useState([]);
  const [filteredSessions, setFilteredSessions] = useState([]);
  const [searchText, setSearchText] = useState("");
  const [deletedRecords, setDeletedRecords] = useState([]);
  const [filteredDeleted, setFilteredDeleted] = useState([]);
  const [deletedSearchText, setDeletedSearchText] = useState("");
  const [selectedStore] = useState("cold");
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

  const unitOptions = ["KG", "GM", "PCS"];

  useEffect(() => {
    const initialize = async () => {
      try {
        const storedStores = await AsyncStorage.getItem(STORAGE_STORES_KEY);
        if (storedStores) {
          const parsed = JSON.parse(storedStores);
          setStores(parsed);
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
            (item.batchCode &&
              item.batchCode
                .slice(-3)
                .toLowerCase()
                .includes(searchText.toLowerCase())) ||
            (item.carcassType &&
              item.carcassType
                .toLowerCase()
                .includes(searchText.toLowerCase())),
        ),
      );
  }, [searchText, savedSessions]);

  useEffect(() => {
    if (deletedSearchText.trim() === "") setFilteredDeleted(deletedRecords);
    else
      setFilteredDeleted(
        deletedRecords.filter(
          (item) =>
            (item.batchCode &&
              item.batchCode
                .slice(-3)
                .toLowerCase()
                .includes(deletedSearchText.toLowerCase())) ||
            (item.carcassType &&
              item.carcassType
                .toLowerCase()
                .includes(deletedSearchText.toLowerCase())),
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
    if (!itemCode.trim()) {
      ToastAndroid.show("Please enter Item Code", ToastAndroid.SHORT);
      return;
    }
    if (!bomType.trim()) {
      ToastAndroid.show("Please enter BOM Type", ToastAndroid.SHORT);
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
      itemCode: itemCode.trim(),
      unit: unit,
      bomType: bomType.trim(),
      captures: capturedRecords,
      totalPieces,
      totalWeight: totalWeightSum,
      date: new Date().toLocaleString(),
      type: "Carcass",
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

      const weightBeforeRecord = {
        id: Date.now().toString(),
        originalSessionId: newSession.id,
        batchCode: batchCode,
        carcassType: carcassType.trim(),
        itemCode: itemCode.trim(),
        unit: unit,
        bomType: bomType.trim(),
        pieces: totalPieces,
        originalReceivedWeight: totalWeightSum,
        weightBefore: null,
        weightAfter: null,
        variance: null,
        status: "pending",
        dateBefore: new Date().toLocaleString(),
        spoilageRemoved: 0,
      };

      const storedWeightBefore = await AsyncStorage.getItem(
        WEIGHT_BEFORE_DEBONNING_KEY,
      );
      let weightBeforeList = storedWeightBefore
        ? JSON.parse(storedWeightBefore)
        : [];
      weightBeforeList.unshift(weightBeforeRecord);
      await AsyncStorage.setItem(
        WEIGHT_BEFORE_DEBONNING_KEY,
        JSON.stringify(weightBeforeList),
      );

      const stockKey = getStockKeyForStore(selectedStore);
      const stock = await AsyncStorage.getItem(stockKey);
      let stockList = stock ? JSON.parse(stock) : [];
      stockList.push({
        id: Date.now().toString(),
        type: carcassType.trim(),
        itemCode: itemCode.trim(),
        unit: unit,
        bomType: bomType.trim(),
        pieces: totalPieces,
        totalWeight: totalWeightSum,
        batchCode: batchCode,
        lastUpdated: new Date().toISOString(),
        isDebonned: false,
        originalReceivedWeight: totalWeightSum,
        source: "Carcass",
        weightBeforeRecordId: weightBeforeRecord.id,
        carcassType: carcassType.trim(),
      });
      await AsyncStorage.setItem(stockKey, JSON.stringify(stockList));
      const businessId = store.getState().settings.BusinessId;
      for (const item of stockList) {
        await syncToFirebase("cold_room_stock", item, businessId);
      }
      ToastAndroid.show(
        `Carcass session saved to Coldroom`,
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
    setItemCode("");
    setUnit("KG");
    setBomType("");
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
      itemCode: session.itemCode || "",
      unit: session.unit || "KG",
      bomType: session.bomType || "",
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

  const renderCaptureItem = ({ item, index }) => (
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
            Item Code: {item.itemCode} | Unit: {item.unit}
          </Text>
          <Text style={styles.sessionInfo}>
            BOM: {item.bomType} | Batch: {item.batchCode}
          </Text>
          <Text style={styles.sessionInfo}>
            {item.totalPieces} pieces | {item.totalWeight.toFixed(2)} kg
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
      <View style={[styles.deletedRecordItem, { flexDirection: "column" }]}>
        <View style={styles.deletedRecordDetails}>
          <Text style={styles.deletedRecordType}>{item.carcassType}</Text>
          <Text style={styles.deletedRecordInfo}>
            Item Code: {item.itemCode} | Unit: {item.unit}
          </Text>
          <Text style={styles.deletedRecordInfo}>
            BOM: {item.bomType} | Batch: {item.batchCode}
          </Text>
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
          <View style={styles.hardcodedContainer}>
            <Text style={styles.hardcodedLabel}>Store:</Text>
            <View style={styles.hardcodedValue}>
              <Text style={styles.hardcodedText}>Coldroom</Text>
            </View>
          </View>

          <View style={styles.hardcodedContainer}>
            <Text style={styles.hardcodedLabel}>Batch Number:</Text>
            <View style={styles.hardcodedValue}>
              <Text style={styles.hardcodedText}>{batchCode}</Text>
            </View>
          </View>

          <TextInput
            style={styles.inputField}
            placeholder="Carcass Type (e.g., Beef, Lamb, Sheep, Goat, Chicken)"
            value={carcassType}
            onChangeText={setCarcassType}
          />

          <TextInput
            style={styles.inputField}
            placeholder="Item Code (e.g., WIP0042)"
            value={itemCode}
            onChangeText={setItemCode}
          />

          <Text style={styles.label}>Unit:</Text>
          <View style={styles.unitContainer}>
            {unitOptions.map((u) => (
              <TouchableOpacity
                key={u}
                style={[styles.unitBtn, unit === u && styles.unitBtnActive]}
                onPress={() => setUnit(u)}
              >
                <Text
                  style={[
                    styles.unitBtnText,
                    unit === u && styles.unitBtnTextActive,
                  ]}
                >
                  {u}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <TextInput
            style={styles.inputField}
            placeholder="BOM Type (e.g., A or S)"
            value={bomType}
            onChangeText={setBomType}
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
            Captured Batches ({capturedRecords.length})
          </Text>
          <FlatList
            data={capturedRecords}
            keyExtractor={(item, index) => item.id + index.toString()}
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
            placeholder="Search by Batch, Item Code or Type..."
            value={searchText}
            onChangeText={setSearchText}
          />
          <FlatList
            data={filteredSessions}
            keyExtractor={(item, index) => item.id + index.toString()}
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
            placeholder="Search by Batch, Item Code or Type..."
            value={deletedSearchText}
            onChangeText={setDeletedSearchText}
          />
          <FlatList
            data={filteredDeleted}
            keyExtractor={(item, index) => item.id + index.toString()}
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
                  Item Code: {sessionToDelete.itemCode}
                </Text>
                <Text style={styles.modalSubtitle}>
                  Batch: {sessionToDelete.batchCode}
                </Text>
                <Text style={styles.modalSubtitle}>
                  BOM: {sessionToDelete.bomType} | Unit: {sessionToDelete.unit}
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
  const user = useSelector((state) => state.settings.user);
  const isSystemAdmin = user?.role === "system_administrator";
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
  const [showDispatchScreen, setShowDispatchScreen] = useState(false);
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

  const handleButcheryClose = (destination) => {
    setShowButcheryScreen(false);
    if (destination === "packing") {
      setShowPackingScreen(true);
    } else if (destination === "processing") {
      setShowProcessingScreen(true);
    }
  };

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
    return <ButcheryScreen onClose={handleButcheryClose} />;
  if (showProcessingScreen)
    return <ProcessingScreen onClose={() => setShowProcessingScreen(false)} />;
  if (showPackingScreen)
    return <PackingScreen onClose={() => setShowPackingScreen(false)} />;
  if (showDispatchScreen)
    return <DispatchScreen onClose={() => setShowDispatchScreen(false)} />;
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
    else if (title === "Dispatch                     (Dispatch Products)")
      setShowDispatchScreen(true);
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
          {isSystemAdmin && (
            <TouchableOpacity
              style={styles.adminToggleBtn}
              onPress={() => navigation.replace("AdminTabLayout")}
            >
              <Text style={styles.adminToggleBtnText}>
                ⚙️ Switch to Admin Panel
              </Text>
            </TouchableOpacity>
          )}

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
              onPress={() => setShowDispatchScreen(true)}
              activeOpacity={0.7}
            >
              <Text style={styles.boxText}>Dispatch (Dispatch Products)</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </ScrollView>
  );
};

// ============ COMPLETE STYLES ============
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
  adminToggleBtn: {
    backgroundColor: "#e94560",
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
    width: "100%",
    alignItems: "center",
    marginBottom: 15,
    shadowColor: "#e94560",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  adminToggleBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 0.5,
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
  tabContainer: {
    flexDirection: "row",
    marginBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#DDD",
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
  },
  activeTab: {
    borderBottomWidth: 2,
    borderBottomColor: "#0066CC",
  },
  tabText: {
    fontSize: 16,
    fontFamily: "Poppins-Medium",
    color: "#666",
  },
  activeTabText: {
    color: "#0066CC",
    fontWeight: "bold",
  },
  hardcodedContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1a1a2e",
    borderRadius: 10,
    paddingHorizontal: 15,
    paddingVertical: 12,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: "#2a2a4a",
    width: "100%",
  },
  hardcodedLabel: {
    color: "#aaa",
    fontSize: 14,
    fontFamily: "Poppins-Medium",
    marginRight: 10,
  },
  hardcodedValue: {
    flex: 1,
    backgroundColor: "#0a0a1a",
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  hardcodedText: {
    color: "#4CAF50",
    fontSize: 14,
    fontFamily: "Poppins-SemiBold",
  },
  unitContainer: {
    flexDirection: "row",
    marginBottom: 15,
    gap: 10,
    width: "100%",
  },
  unitBtn: {
    flex: 1,
    backgroundColor: "#2a2a4a",
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
  },
  unitBtnActive: {
    backgroundColor: "#e94560",
  },
  unitBtnText: {
    color: "#aaa",
    fontSize: 14,
    fontFamily: "Poppins-Medium",
  },
  unitBtnTextActive: {
    color: "#fff",
  },
  label: {
    color: "#aaa",
    marginBottom: 6,
    fontSize: 12,
    fontFamily: "Poppins-Medium",
    width: "100%",
  },
  sessionInfo: {
    fontSize: responsiveSize(14),
    fontFamily: "Poppins-Regular",
    color: "#666",
    marginVertical: 4,
  },
  sessionType: {
    fontSize: responsiveSize(18),
    fontFamily: "Poppins-Bold",
    color: "#333",
    marginVertical: 4,
  },
});

export default HomePage;
