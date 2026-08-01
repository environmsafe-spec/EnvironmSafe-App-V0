# The WebView calls these methods by name from JavaScript, so they must survive
# shrinking even though nothing in the Kotlin code calls them.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class com.environmsafe.app.MainActivity$FileBridge { *; }
-dontwarn com.environmsafe.**
