import React from 'react';
import { Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';

import HomeScreen from '../screens/HomeScreen';
import AnalysisScreen from '../screens/AnalysisScreen';
import HistoryScreen from '../screens/HistoryScreen';
import SettingsScreen from '../screens/SettingsScreen';
import EditMealScreen from '../screens/EditMealScreen';
import MealDetailScreen from '../screens/MealDetailScreen';
import { colors, fontSize } from '../theme';

const Tab = createBottomTabNavigator();
const HomeStack = createStackNavigator();
const HistoryStack = createStackNavigator();

const SCREEN_OPTIONS = {
  headerStyle: { backgroundColor: colors.white },
  headerTintColor: colors.text,
  headerTitleStyle: { fontWeight: '600', fontSize: fontSize.lg },
};

function HomeStackNavigator() {
  return (
    <HomeStack.Navigator screenOptions={SCREEN_OPTIONS}>
      <HomeStack.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
      <HomeStack.Screen
        name="Analysis"
        component={AnalysisScreen}
        options={{ title: 'Food Analysis', presentation: 'modal' }}
      />
      <HomeStack.Screen
        name="MealDetail"
        component={MealDetailScreen}
        options={{ title: 'Meal Details' }}
      />
      <HomeStack.Screen
        name="EditMeal"
        component={EditMealScreen}
        options={{ title: 'Edit Meal' }}
      />
    </HomeStack.Navigator>
  );
}

function HistoryStackNavigator() {
  return (
    <HistoryStack.Navigator screenOptions={SCREEN_OPTIONS}>
      <HistoryStack.Screen name="History" component={HistoryScreen} options={{ headerShown: false }} />
      <HistoryStack.Screen
        name="MealDetail"
        component={MealDetailScreen}
        options={{ title: 'Meal Details' }}
      />
      <HistoryStack.Screen
        name="EditMeal"
        component={EditMealScreen}
        options={{ title: 'Edit Meal' }}
      />
    </HistoryStack.Navigator>
  );
}

const TAB_ICONS = {
  HomeTab:    { focused: '🏠', unfocused: '🏡' },
  HistoryTab: { focused: '📊', unfocused: '📈' },
  SettingsTab: { focused: '⚙️', unfocused: '⚙️' },
};

export default function AppNavigator() {
  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarStyle: {
            backgroundColor: colors.white,
            borderTopColor: colors.border,
            borderTopWidth: 1,
            paddingTop: 6,
          },
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.textSecondary,
          tabBarLabelStyle: { fontSize: fontSize.xs, fontWeight: '600', marginTop: 2 },
          tabBarIcon: ({ focused }) => {
            const icons = TAB_ICONS[route.name];
            return <Text style={{ fontSize: 24 }}>{focused ? icons.focused : icons.unfocused}</Text>;
          },
        })}
      >
        <Tab.Screen name="HomeTab" component={HomeStackNavigator} options={{ title: 'Today' }} />
        <Tab.Screen name="HistoryTab" component={HistoryStackNavigator} options={{ title: 'History' }} />
        <Tab.Screen name="SettingsTab" component={SettingsScreen} options={{ title: 'Settings' }} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
