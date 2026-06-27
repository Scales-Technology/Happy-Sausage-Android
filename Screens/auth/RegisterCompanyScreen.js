// Screens/auth/RegisterCompanyScreen.js
// MODIFIED - Matches LoginScreen design

import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ToastAndroid,
  Dimensions,
  StatusBar,
} from "react-native";
import { db } from "../../Database/config";
import { collection, addDoc } from "firebase/firestore";

const { width, height } = Dimensions.get("window");

const RegisterCompanyScreen = ({ navigation }) => {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);

  // Form data
  const [companyName, setCompanyName] = useState("");
  const [location, setLocation] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const getIcon = (name) => {
    const icons = {
      business: "🏢",
      location: "📍",
      person: "👤",
      mail: "📧",
      lock: "🔒",
      shield: "🛡️",
      back: "←",
      forward: "→",
      rocket: "🚀",
    };
    return icons[name] || "•";
  };

  const handleRegister = async () => {
    // Validation
    if (!companyName.trim()) {
      ToastAndroid.show("Please enter company name", ToastAndroid.SHORT);
      return;
    }
    if (!location.trim()) {
      ToastAndroid.show("Please enter location", ToastAndroid.SHORT);
      return;
    }
    if (!adminName.trim()) {
      ToastAndroid.show("Please enter admin name", ToastAndroid.SHORT);
      return;
    }
    if (!adminEmail.trim()) {
      ToastAndroid.show("Please enter admin email", ToastAndroid.SHORT);
      return;
    }
    if (!password) {
      ToastAndroid.show("Please enter password", ToastAndroid.SHORT);
      return;
    }
    if (password !== confirmPassword) {
      ToastAndroid.show("Passwords do not match", ToastAndroid.SHORT);
      return;
    }
    if (password.length < 6) {
      ToastAndroid.show(
        "Password must be at least 6 characters",
        ToastAndroid.SHORT,
      );
      return;
    }

    setLoading(true);

    try {
      // 1. Create Business document (matches your existing structure)
      const businessRef = await addDoc(collection(db, "Businesses"), {
        name: companyName.trim(),
        location: location.trim(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        settings: {
          requireApprovalForRemoval: true,
          currency: "KES",
          timezone: "Africa/Nairobi",
        },
      });

      // 2. Create Clerk (Admin) - This is what your Login page looks for!
      const clerkData = {
        fName: adminName.trim().split(" ")[0] || "",
        lName: adminName.trim().split(" ").slice(1).join(" ") || "",
        Id: password,
        email: adminEmail.trim(),
        role: "system_administrator",
        isActive: true,
        isCompanyAdmin: true,
        createdAt: new Date().toISOString(),
        lastLogin: new Date().toISOString(),
      };

      await addDoc(collection(businessRef, "Clerks"), clerkData);

      ToastAndroid.show("Company registered successfully!", ToastAndroid.LONG);

      // Navigate to AdminDashboard
      navigation.replace("AdminDashboard");
    } catch (error) {
      console.error("Registration error:", error);
      ToastAndroid.show("Registration failed. Try again.", ToastAndroid.SHORT);
    } finally {
      setLoading(false);
    }
  };

  const nextStep = () => {
    if (step === 1) {
      if (!companyName.trim()) {
        ToastAndroid.show("Please enter company name", ToastAndroid.SHORT);
        return;
      }
      if (!location.trim()) {
        ToastAndroid.show("Please enter location", ToastAndroid.SHORT);
        return;
      }
      setStep(2);
    } else if (step === 2) {
      if (!adminName.trim()) {
        ToastAndroid.show("Please enter admin name", ToastAndroid.SHORT);
        return;
      }
      setStep(3);
    }
  };

  const prevStep = () => {
    if (step > 1) setStep(step - 1);
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0a0a0a" />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.keyboardView}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Header Section - Matching LoginScreen */}
          <View style={styles.headerSection}>
            <View style={styles.logoContainer}>
              <View style={styles.logoCircle}>
                <Text style={styles.logoText}>🥩</Text>
              </View>
            </View>
            <Text style={styles.appTitle}>HAPPY SAUSAGE</Text>
            <Text style={styles.appSubtitle}>MEAT PROCESSING SYSTEM</Text>
          </View>

          {/* Register Title */}
          <View style={styles.registerHeader}>
            <Text style={styles.registerTitle}>
              Register Company / Jisajili
            </Text>
            <TouchableOpacity onPress={() => navigation.navigate("LoginPage")}>
              <Text style={styles.signInLink}>Sign In / Ingia</Text>
            </TouchableOpacity>
          </View>

          {/* Progress Indicator */}
          <View style={styles.progressContainer}>
            <View
              style={[
                styles.progressStep,
                step >= 1 && styles.progressStepActive,
              ]}
            >
              <View
                style={[
                  styles.progressCircle,
                  step >= 1 && styles.progressCircleActive,
                ]}
              >
                <Text
                  style={[
                    styles.progressNumber,
                    step >= 1 && styles.progressNumberActive,
                  ]}
                >
                  1
                </Text>
              </View>
              <Text
                style={[
                  styles.progressLabel,
                  step >= 1 && styles.progressLabelActive,
                ]}
              >
                Company
              </Text>
            </View>
            <View
              style={[
                styles.progressLine,
                step >= 2 && styles.progressLineActive,
              ]}
            />
            <View
              style={[
                styles.progressStep,
                step >= 2 && styles.progressStepActive,
              ]}
            >
              <View
                style={[
                  styles.progressCircle,
                  step >= 2 && styles.progressCircleActive,
                ]}
              >
                <Text
                  style={[
                    styles.progressNumber,
                    step >= 2 && styles.progressNumberActive,
                  ]}
                >
                  2
                </Text>
              </View>
              <Text
                style={[
                  styles.progressLabel,
                  step >= 2 && styles.progressLabelActive,
                ]}
              >
                Admin
              </Text>
            </View>
            <View
              style={[
                styles.progressLine,
                step >= 3 && styles.progressLineActive,
              ]}
            />
            <View
              style={[
                styles.progressStep,
                step >= 3 && styles.progressStepActive,
              ]}
            >
              <View
                style={[
                  styles.progressCircle,
                  step >= 3 && styles.progressCircleActive,
                ]}
              >
                <Text
                  style={[
                    styles.progressNumber,
                    step >= 3 && styles.progressNumberActive,
                  ]}
                >
                  3
                </Text>
              </View>
              <Text
                style={[
                  styles.progressLabel,
                  step >= 3 && styles.progressLabelActive,
                ]}
              >
                Security
              </Text>
            </View>
          </View>

          {/* Form Card */}
          <View style={styles.formCard}>
            {step === 1 && (
              <View>
                <Text style={styles.sectionTitle}>Company Information</Text>

                <View style={styles.inputContainer}>
                  <Text style={styles.inputIcon}>{getIcon("business")}</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Company Name"
                    placeholderTextColor="#888"
                    value={companyName}
                    onChangeText={setCompanyName}
                  />
                </View>

                <View style={styles.inputContainer}>
                  <Text style={styles.inputIcon}>{getIcon("location")}</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Location (e.g., Nairobi, Kenya)"
                    placeholderTextColor="#888"
                    value={location}
                    onChangeText={setLocation}
                  />
                </View>
              </View>
            )}

            {step === 2 && (
              <View>
                <Text style={styles.sectionTitle}>Admin Information</Text>

                <View style={styles.inputContainer}>
                  <Text style={styles.inputIcon}>{getIcon("person")}</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Full Name"
                    placeholderTextColor="#888"
                    value={adminName}
                    onChangeText={setAdminName}
                  />
                </View>

                <View style={styles.inputContainer}>
                  <Text style={styles.inputIcon}>{getIcon("mail")}</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Email Address"
                    placeholderTextColor="#888"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    value={adminEmail}
                    onChangeText={setAdminEmail}
                  />
                </View>
              </View>
            )}

            {step === 3 && (
              <View>
                <Text style={styles.sectionTitle}>Security Settings</Text>

                <View style={styles.inputContainer}>
                  <Text style={styles.inputIcon}>{getIcon("lock")}</Text>
                  <TextInput
                    style={[styles.input, { flex: 1 }]}
                    placeholder="Password"
                    placeholderTextColor="#888"
                    secureTextEntry={!showPassword}
                    value={password}
                    onChangeText={setPassword}
                  />
                  <TouchableOpacity
                    onPress={() => setShowPassword(!showPassword)}
                  >
                    <Text style={styles.eyeIcon}>
                      {showPassword ? "👁️" : "👁️‍🗨️"}
                    </Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.inputContainer}>
                  <Text style={styles.inputIcon}>{getIcon("shield")}</Text>
                  <TextInput
                    style={[styles.input, { flex: 1 }]}
                    placeholder="Confirm Password"
                    placeholderTextColor="#888"
                    secureTextEntry={!showConfirmPassword}
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                  />
                  <TouchableOpacity
                    onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                  >
                    <Text style={styles.eyeIcon}>
                      {showConfirmPassword ? "👁️" : "👁️‍🗨️"}
                    </Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.securityNote}>
                  <Text style={styles.securityNoteIcon}>ℹ️</Text>
                  <Text style={styles.securityNoteText}>
                    Password must be at least 6 characters
                  </Text>
                </View>
              </View>
            )}

            <View style={styles.buttonContainer}>
              {step > 1 && (
                <TouchableOpacity style={styles.backButton} onPress={prevStep}>
                  <Text style={styles.backButtonText}>
                    {getIcon("back")} Back
                  </Text>
                </TouchableOpacity>
              )}

              {step < 3 ? (
                <TouchableOpacity style={styles.nextButton} onPress={nextStep}>
                  <Text style={styles.nextButtonText}>
                    Continue {getIcon("forward")}
                  </Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[
                    styles.registerButton,
                    loading && styles.registerButtonDisabled,
                  ]}
                  onPress={handleRegister}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.registerButtonText}>
                      Create Account {getIcon("rocket")}
                    </Text>
                  )}
                </TouchableOpacity>
              )}
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
  // Header Section - Matching LoginScreen
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
  // Register Header
  registerHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  registerTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#fff",
  },
  signInLink: {
    fontSize: 12,
    color: "#e94560",
  },
  // Progress Indicator
  progressContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 25,
    paddingHorizontal: 20,
  },
  progressStep: {
    alignItems: "center",
  },
  progressCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#2a2a4a",
    justifyContent: "center",
    alignItems: "center",
  },
  progressCircleActive: {
    backgroundColor: "#e94560",
  },
  progressNumber: {
    color: "#888",
    fontWeight: "bold",
    fontSize: 14,
  },
  progressNumberActive: {
    color: "#fff",
  },
  progressLabel: {
    fontSize: 9,
    color: "#888",
    marginTop: 4,
  },
  progressLabelActive: {
    color: "#e94560",
  },
  progressLine: {
    width: 35,
    height: 2,
    backgroundColor: "#2a2a4a",
    marginHorizontal: 6,
  },
  progressLineActive: {
    backgroundColor: "#e94560",
  },
  // Form Card
  formCard: {
    backgroundColor: "#1a1a2e",
    borderRadius: 24,
    padding: 20,
    marginHorizontal: 20,
    marginBottom: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
    marginBottom: 16,
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#0f0f1a",
    borderRadius: 12,
    marginBottom: 14,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: "#2a2a4a",
  },
  inputIcon: {
    fontSize: 18,
    marginRight: 10,
  },
  input: {
    flex: 1,
    height: 48,
    color: "#fff",
    fontSize: 15,
  },
  eyeIcon: {
    fontSize: 18,
    color: "#888",
  },
  buttonContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 16,
    gap: 12,
  },
  backButton: {
    flex: 1,
    backgroundColor: "#2a2a4a",
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  backButtonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "500",
  },
  nextButton: {
    flex: 1,
    backgroundColor: "#e94560",
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  nextButtonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  registerButton: {
    flex: 1,
    backgroundColor: "#e94560",
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  registerButtonDisabled: {
    opacity: 0.6,
  },
  registerButtonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  securityNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
  },
  securityNoteIcon: {
    fontSize: 12,
  },
  securityNoteText: {
    color: "#888",
    fontSize: 11,
  },
});

export default RegisterCompanyScreen;
