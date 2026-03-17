import React, { useEffect, useState, useCallback } from "react";
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
import DropdownComponent from "../Components/DropDown";
import Header from "../Components/Header";
import { useNavigation } from "@react-navigation/native";
import { store } from "../store/store";
import { setCollectionRecords, setLocations, setProducts } from "../store";
import { useDispatch } from "react-redux";
import { collection, getDocs, query, orderBy } from "firebase/firestore";
import { db } from "../Database/config";
import { useBluetooth } from "rn-bluetooth-classic";
import RNBluetooth from "react-native-bluetooth-classic";

const screenWidth = Dimensions.get("window").width;

// Responsive sizing function
const responsiveSize = (size) => {
  const standardWidth = 375;
  return (screenWidth * size) / standardWidth;
};

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

  const BusinessId = store.getState().settings.BusinessId;

  // Generate batch code
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
            const numPart = parts[2];
            const num = parseInt(numPart);
            if (!isNaN(num) && num > maxNumber) {
              maxNumber = num;
            }
          }
        }
      });

      const today = new Date();
      const dateStr = today.toISOString().slice(0, 10).replace(/-/g, "");
      const nextNumber = maxNumber + 1;
      const newCode = `BATCH-${dateStr}-${String(nextNumber).padStart(3, "0")}`;

      setBatchCode(newCode);
      console.log("Generated batch code:", newCode);
      return newCode;
    } catch (e) {
      console.error("Error generating batch code:", e);
      const today = new Date();
      const dateStr = today.toISOString().slice(0, 10).replace(/-/g, "");
      const newCode = `BATCH-${dateStr}-001`;
      setBatchCode(newCode);
      return newCode;
    }
  };

  // Generate new batch code when button is pressed
  const generateNewBatchCode = async () => {
    await generateBatchCode();
    ToastAndroid.show("New batch code generated", ToastAndroid.SHORT);
  };

  // Fetch clients from Clients collection
  const getClients = useCallback(async () => {
    try {
      const snapshot = await getDocs(
        collection(db, `Businesses/${BusinessId}/Clients`),
      );
      const clients = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      // Create dropdown options from clients
      const clientOptions = clients.map((client) => ({
        label: `${client.fName || ""} ${client.lName || ""}`.trim(),
        value: client.id,
        clientData: client, // Store full data for later use
      }));

      setClientsData(clientOptions);
      console.log("Fetched clients:", clientOptions.length);
      return clientOptions;
    } catch (error) {
      console.log("Error fetching clients:", error);
      ToastAndroid.show("Error fetching clients", ToastAndroid.SHORT);
      return [];
    }
  }, [BusinessId]);

  // Fetch locations for destinations
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
      console.log("Fetched locations:", locations.length);
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
      const daily = myRecords.filter((r) => {
        const d = new Date(r.timestamp);
        return d.toDateString() === today.toDateString();
      }).length;

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

  // Load data
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
    ]).finally(() => setRefreshing(false));
  }, [getProducts, getLocations, getCarcasTypes, getClients]);

  const handleNavigate = () => {
    console.log("=== HOMEPAGE NAVIGATION DEBUG ===");
    console.log("Selected Client:", selectedClient);
    console.log("Selected Destination:", selectedDestination);
    console.log("Selected Carcas Type:", selectedCarcasType);
    console.log("Batch Code:", batchCode);
    console.log("=== END DEBUG ===");

    if (!selectedClient) {
      ToastAndroid.show("Please select a client", ToastAndroid.SHORT);
      return;
    }
    if (!selectedDestination) {
      ToastAndroid.show("Please select a destination", ToastAndroid.SHORT);
      return;
    }

    // Get client data from the selected client object
    const clientId = selectedClient?.value || "";
    const clientFullName = selectedClient?.label || "";
    const clientData = selectedClient?.clientData || {};

    // IMPORTANT: Create the supplier object structure that will be saved to Firestore
    const supplier = {
      id: clientId,
      name: clientFullName,
      fName: clientData.fName || "",
      lName: clientData.lName || "",
      phoneNumber: clientData.phoneNumber || "",
      location: clientData.location || "",
      // Include any other client fields you need
    };

    const destinationId = selectedDestination?.value || "";
    const destinationName = selectedDestination?.label || "";
    const carcasTypeId = selectedCarcasType?.value || "";
    const carcasTypeName = selectedCarcasType?.label || "";

    console.log("Extracted Data for Navigation:", {
      supplier, // This is the key part - sending supplier object
      supplierId: clientId,
      supplierName: clientFullName,
      destinationId,
      destinationName,
      batchCode,
      carcasTypeId,
      carcasTypeName,
      clientPhone: clientData.phoneNumber || "",
      clientLocation: clientData.location || "",
    });

    // Create navigation parameters
    const navParams = {
      supplier: supplier, // Pass the supplier object directly
      supplierId: clientId,
      supplierName: clientFullName,
      clientId: clientId, // Keep for backward compatibility
      clientName: clientFullName, // Keep for backward compatibility
      clientFirstName: clientData.fName || "",
      clientLastName: clientData.lName || "",
      clientPhone: clientData.phoneNumber || "",
      clientLocation: clientData.location || "",
      destinationId: destinationId,
      destinationName: destinationName,
      batchCode: batchCode,
      carcasTypeId: carcasTypeId,
      carcasTypeName: carcasTypeName,
      tagId: "",
      ageMonths: 0,
    };

    // Generate a new batch code for next time
    setTimeout(() => {
      generateBatchCode();
    }, 100);

    navigation.navigate("RecordPage", navParams);
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
          {/* 1. BATCH CODE - FIXED LAYOUT */}
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

          {/* 2. CLIENT - Fetches from Clients collection */}
          <DropdownComponent
            title="Client"
            onChange={setSelectedClient}
            data={clientsData}
            placeholder="Select Client"
          />

          {/* 3. DESTINATION - Fetches from Locations collection */}
          <DropdownComponent
            title="Destination"
            onChange={setSelectedDestination}
            data={locationsData}
            placeholder="Select Destination"
          />

          {/* 4. CARCAS TYPE */}
          <DropdownComponent
            title="Carcas Type"
            onChange={setSelectedCarcasType}
            data={carcasTypesData}
            value={selectedCarcasType}
            placeholder="Select Carcas Type"
          />
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
  // Fixed Batch Code Container
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
    marginRight: responsiveSize(60), // Space for refresh button
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
  refreshText: {
    color: "#FFFFFF",
    fontSize: responsiveSize(10),
    fontFamily: "Poppins-Medium",
  },
  // Original input style kept for reference but not used
  input: {
    height: responsiveSize(50),
    borderRadius: responsiveSize(30),
    paddingHorizontal: responsiveSize(20),
    backgroundColor: "#F2F2F2",
    width: "100%",
    justifyContent: "center",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  button: {
    height: responsiveSize(50),
    borderRadius: responsiveSize(30),
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
  },
  button_Bg: { backgroundColor: "#F2F2F2" },
  startButton: {
    marginTop: responsiveSize(30),
  },
  buttonText: {
    fontSize: responsiveSize(16),
    fontFamily: "Poppins-Medium",
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
