// Stack.js - MODIFIED with AdminTabLayout that includes Settings button
// REMOVED: SystemAdminDashboard - using AdminDashboard instead

import React from "react";
import { createStackNavigator } from "@react-navigation/stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import CustomTabBar from "../Components/CustomTabBar";
import HomePage from "../Screens/HomePage";
import RecordPage from "../Screens/RecordPage";
import SettingsPage from "../Screens/SettingsPage";
import LoginPage from "../Screens/LoginPage";
import RegisterCompanyScreen from "../Screens/auth/RegisterCompanyScreen";
import AdminDashboard from "../Screens/admin/AdminDashboard";
import AdvancementsPage from "../Screens/AdvancementsPage";
// SystemAdminDashboard import REMOVED

const Stack = createStackNavigator();
const Tab = createBottomTabNavigator();

// Employee Tab Layout (WITH Settings button)
export const TabLayout = () => {
  return (
    <Tab.Navigator
      initialRouteName="HomePage"
      screenOptions={{
        headerShown: false,
      }}
      tabBar={(props) => <CustomTabBar {...props} />}
    >
      <Tab.Screen name="HomePage" component={HomePage} />
      <Tab.Screen name="SettingsPage" component={SettingsPage} />
    </Tab.Navigator>
  );
};

// ============ ADMIN TAB LAYOUT (WITH SETTINGS BUTTON) ============
export const AdminTabLayout = () => {
  return (
    <Tab.Navigator
      initialRouteName="AdminDashboard"
      screenOptions={{
        headerShown: false,
      }}
      tabBar={(props) => <CustomTabBar {...props} />}
    >
      <Tab.Screen name="AdminDashboard" component={AdminDashboard} />
      <Tab.Screen name="SettingsPage" component={SettingsPage} />
    </Tab.Navigator>
  );
};

export function MyStack() {
  return (
    <Stack.Navigator initialRouteName="RegisterCompany">
      {/* Company Registration Screen (First time users) */}
      <Stack.Screen
        name="RegisterCompany"
        component={RegisterCompanyScreen}
        options={{ headerShown: false }}
      />

      {/* Admin Dashboard Screen */}
      <Stack.Screen
        name="AdminDashboard"
        component={AdminDashboard}
        options={{ headerShown: false }}
      />

      {/* Admin Tab Layout (WITH Settings button) */}
      <Stack.Screen
        name="AdminTabLayout"
        component={AdminTabLayout}
        options={{ headerShown: false }}
      />

      {/* Storekeeper Dashboard - COMMENTED OUT (not created yet) */}
      {/* <Stack.Screen
        name="StorekeeperDashboard"
        component={StorekeeperDashboard}
        options={{ headerShown: false }}
      /> */}

      {/* Dispatch Clerk Dashboard - COMMENTED OUT (not created yet) */}
      {/* <Stack.Screen
        name="DispatchClerkDashboard"
        component={DispatchClerkDashboard}
        options={{ headerShown: false }}
      /> */}

      {/* Login Screen */}
      <Stack.Screen
        name="LoginPage"
        component={LoginPage}
        options={{ headerShown: false }}
      />

      {/* Employee Main Screen with Bottom Tabs */}
      <Stack.Screen
        name="TabLayout"
        component={TabLayout}
        options={{ headerShown: false }}
      />

      {/* Record Page for Field Collection */}
      <Stack.Screen
        name="RecordPage"
        component={RecordPage}
        options={{ headerShown: false }}
      />

      {/* Advancements Page */}
      <Stack.Screen
        name="AdvancementsPage"
        component={AdvancementsPage}
        options={{ headerShown: false }}
      />
    </Stack.Navigator>
  );
}
