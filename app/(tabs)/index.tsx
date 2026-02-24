import React from "react";
import { View, Text, TouchableOpacity, StyleSheet, Platform } from "react-native";
import SportScreen from "@/components/SportScreen";
import { Ionicons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import * as Linking from 'expo-linking';

export default function FootballTab() {
  const downloadDocs = () => {
    Linking.openURL(window.location.origin + '/api_docs.md');
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity 
        style={styles.downloadBar} 
        onPress={downloadDocs}
      >
        <Ionicons name="document-text-outline" size={18} color={Colors.dark.accent} />
        <Text style={styles.downloadText}>Download API Endpoints & Proxy Config</Text>
        <Ionicons name="download-outline" size={18} color={Colors.dark.accent} />
      </TouchableOpacity>
      <SportScreen sport="football" title="Football" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  downloadBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.dark.surfaceSecondary,
    paddingVertical: 10,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.border,
  },
  downloadText: {
    color: Colors.dark.text,
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  }
});
