// OTP Gateway: turns an Android phone with a SIM into the SMS / missed-call gateway for the
// OTP Verify service. No libraries beyond the Android framework and the Kotlin standard library.
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.otpverify.gateway"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.otpverify.gateway"
        minSdk = 29 // call screening (CallScreeningService + RoleManager) needs Android 10
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    lint {
        abortOnError = false
    }
}
