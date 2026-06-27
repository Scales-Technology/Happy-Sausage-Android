// Screens/LoginPage.js
// MODIFIED - Routes to AdminTabLayout (which has Settings button)

import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  Dimensions,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  StatusBar,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { useDispatch, useSelector } from "react-redux";
import { setUser, setLoggedIn, setBusinessId } from "../store/store";
import { db } from "../Database/config";
import { collection, getDocs, query, where } from "firebase/firestore";

const { width, height } = Dimensions.get("window");

const LoginPage = ({ navigation }) => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const dispatch = useDispatch();

  useEffect(() => {
    // Just set ready to true - no auto-redirect
    setReady(true);
  }, []);

  const handleLogin = async () => {
    setError("");
    setLoading(true);

    const trimmedUsername = username.trim();
    const trimmedPassword = password.trim();

    if (trimmedUsername === "" || trimmedPassword === "") {
      setError("Please enter your username and password.");
      setLoading(false);
      return;
    }

    try {
      const businessCollections = await getDocs(collection(db, "Businesses"));
      let isValidLogin = false;
      let userRole = "";
      let userData = null;
      let businessId = "";

      for (const businessDoc of businessCollections.docs) {
        const clerkCollection = await getDocs(
          query(
            collection(businessDoc.ref, "Clerks"),
            where("fName", "==", trimmedUsername),
            where("Id", "==", trimmedPassword),
          ),
        );

        if (!clerkCollection.empty) {
          const clerkDoc = clerkCollection.docs[0];
          userData = {
            clerkId: clerkDoc.id,
            ...clerkDoc.data(),
          };
          userRole = userData.role || "storekeeper";
          businessId = businessDoc.id;
          isValidLogin = true;
          break;
        }
      }

      if (!isValidLogin) {
        setError("Invalid username or password.");
        setLoading(false);
        return;
      }

      // Log user data for debugging
      console.log("User logged in:", userData);
      console.log("User role:", userRole);

      // Save to Redux
      dispatch(setBusinessId(businessId));
      dispatch(setUser(userData));
      dispatch(setLoggedIn(true));

      // ============ ROLE-BASED NAVIGATION ============
      if (userRole === "system_administrator") {
        // System Admin goes to AdminTabLayout (has Settings button with logout)
        navigation.replace("AdminTabLayout");
      } else {
        // All other roles go to TabLayout (HomePage with boxes)
        navigation.replace("TabLayout");
      }
    } catch (error) {
      console.error("Error fetching data: ", error);
      setError("Failed to fetch data. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (!ready) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#e94560" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0a0a0a" />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.keyboardView}
      >
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.headerSection}>
            <View style={styles.logoContainer}>
              <View style={styles.logoCircle}>
                <Text style={styles.logoText}>🥩</Text>
              </View>
            </View>
            <Text style={styles.appTitle}>HAPPY SAUSAGE</Text>
            <Text style={styles.appSubtitle}>MEAT PROCESSING SYSTEM</Text>
            {/*<Text style={styles.poweredBy}>Powered by BLE: Kenya</Text>*/}
          </View>

          <View style={styles.signInSection}>
            <Text style={styles.signInTitle}>Sign In / Ingia</Text>
            <TouchableOpacity
              onPress={() => navigation.navigate("RegisterCompany")}
            >
              <Text style={styles.registerLink}>
                Register Company / Jisajili
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.formCard}>
            <Text style={styles.welcomeTitle}>Welcome Back / Karibu Tena</Text>
            <Text style={styles.welcomeSubtitle}>Sign in to your account</Text>

            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            <Text style={styles.fieldLabel}>Username / Jina la Mtumiaji</Text>
            <View style={styles.inputContainer}>
              <TextInput
                style={styles.input}
                placeholder="Enter your first name"
                placeholderTextColor="#888"
                value={username}
                onChangeText={setUsername}
                autoCapitalize="none"
              />
            </View>

            <Text style={styles.fieldLabel}>Password / Nenosiri</Text>
            <View style={styles.inputContainer}>
              <TextInput
                style={styles.input}
                placeholder="************"
                placeholderTextColor="#888"
                secureTextEntry
                value={password}
                onChangeText={setPassword}
              />
            </View>

            <TouchableOpacity style={styles.loginButton} onPress={handleLogin}>
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.loginButtonText}>Sign In / Ingia →</Text>
              )}
            </TouchableOpacity>

            <View style={styles.registerContainer}>
              <Text style={styles.registerText}>
                New company? / Kampuni mpya?{" "}
              </Text>
              <TouchableOpacity
                onPress={() => navigation.navigate("RegisterCompany")}
              >
                <Text style={styles.registerHereLink}>
                  Register here / Jisajili hapa
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.rolesSection}>
            <Text style={styles.rolesTitle}>System Roles</Text>
            <View style={styles.rolesGrid}>
              <View style={styles.roleBadge}>
                <Text style={styles.roleBadgeText}>System Admin</Text>
              </View>
              <View style={styles.roleBadge}>
                <Text style={styles.roleBadgeText}>Storekeeper</Text>
              </View>
              <View style={styles.roleBadge}>
                <Text style={styles.roleBadgeText}>Dispatch Clerk</Text>
              </View>
              <View style={styles.roleBadge}>
                <Text style={styles.roleBadgeText}>Accountant</Text>
              </View>
              <View style={styles.roleBadge}>
                <Text style={styles.roleBadgeText}>Finance Manager</Text>
              </View>
              <View style={styles.roleBadge}>
                <Text style={styles.roleBadgeText}>Internal Auditor</Text>
              </View>
              <View style={styles.roleBadge}>
                <Text style={styles.roleBadgeText}>Production Manager</Text>
              </View>
              <View style={styles.roleBadge}>
                <Text style={styles.roleBadgeText}>General Manager</Text>
              </View>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0a0a0a",
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 40,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#0a0a0a",
  },
  headerSection: {
    alignItems: "center",
    marginTop: 50,
    marginBottom: 20,
    paddingHorizontal: 20,
  },
  logoContainer: {
    marginBottom: 12,
  },
  logoCircle: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: "#e94560",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#e94560",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  logoText: {
    fontSize: 35,
  },
  appTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#fff",
    letterSpacing: 1,
  },
  appSubtitle: {
    fontSize: 10,
    color: "#e94560",
    letterSpacing: 1,
    marginTop: 2,
  },
  poweredBy: {
    fontSize: 9,
    color: "#666",
    marginTop: 6,
  },
  signInSection: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  signInTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#fff",
  },
  registerLink: {
    fontSize: 11,
    color: "#e94560",
  },
  formCard: {
    backgroundColor: "#1a1a2e",
    borderRadius: 20,
    padding: 20,
    marginHorizontal: 20,
    marginBottom: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  welcomeTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#fff",
    marginBottom: 4,
  },
  welcomeSubtitle: {
    fontSize: 12,
    color: "#aaa",
    marginBottom: 20,
  },
  fieldLabel: {
    fontSize: 12,
    color: "#aaa",
    marginBottom: 6,
  },
  inputContainer: {
    backgroundColor: "#0f0f1a",
    borderRadius: 10,
    marginBottom: 14,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: "#2a2a4a",
  },
  input: {
    height: 48,
    color: "#fff",
    fontSize: 14,
  },
  errorText: {
    color: "#e94560",
    textAlign: "center",
    marginBottom: 16,
    fontSize: 12,
  },
  loginButton: {
    backgroundColor: "#e94560",
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 8,
    marginBottom: 16,
  },
  loginButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  registerContainer: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    flexWrap: "wrap",
  },
  registerText: {
    color: "#aaa",
    fontSize: 12,
  },
  registerHereLink: {
    color: "#e94560",
    fontSize: 12,
    fontWeight: "600",
  },
  rolesSection: {
    paddingHorizontal: 20,
    marginTop: 10,
    marginBottom: 20,
  },
  rolesTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#fff",
    marginBottom: 10,
    textAlign: "center",
  },
  rolesGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 6,
  },
  roleBadge: {
    backgroundColor: "#1a1a2e",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: "#2a2a4a",
  },
  roleBadgeText: {
    color: "#aaa",
    fontSize: 9,
  },
});

export default LoginPage;
