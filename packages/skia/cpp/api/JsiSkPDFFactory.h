#pragma once

#include <ctime>
#include <memory>
#include <string>
#include <utility>

#include <jsi/jsi.h>

#include "JsiSkHostObjects.h"
#include "JsiSkPDFDocument.h"

#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdocumentation"

#include "include/docs/SkPDFDocument.h"
#include "include/docs/SkPDFJpegHelpers.h"

#pragma clang diagnostic pop

namespace RNSkia {

namespace jsi = facebook::jsi;

class JsiSkPDFFactory : public JsiSkHostObject {
public:
  JSI_HOST_FUNCTION(MakeDocument) {
#if defined(SK_SUPPORT_PDF)
    // Start from the JPEG helper metadata so the document can decode and
    // encode embedded images as JPEG (avoids an internal assert and much
    // larger, deflate-only output).
    auto metadata = SkPDF::JPEG::MetadataWithCallbacks();
    // Print-first default: rasterize unsupported features at 300 DPI instead
    // of Skia's 72 DPI screen default.
    metadata.fRasterDPI = 300;
    if (count > 0 && !arguments[0].isUndefined() && !arguments[0].isNull()) {
      auto values = getArgumentAsObject(runtime, arguments, count, 0);
      readString(runtime, values, "title", metadata.fTitle);
      readString(runtime, values, "author", metadata.fAuthor);
      readString(runtime, values, "subject", metadata.fSubject);
      readString(runtime, values, "keywords", metadata.fKeywords);
      readString(runtime, values, "creator", metadata.fCreator);
      readString(runtime, values, "producer", metadata.fProducer);
      readString(runtime, values, "lang", metadata.fLang);
      auto rasterDPI = values.getProperty(runtime, "rasterDPI");
      if (rasterDPI.isNumber()) {
        metadata.fRasterDPI = static_cast<SkScalar>(rasterDPI.asNumber());
      }
      auto encodingQuality = values.getProperty(runtime, "encodingQuality");
      if (encodingQuality.isNumber()) {
        metadata.fEncodingQuality =
            static_cast<int>(encodingQuality.asNumber());
      }
      readDate(runtime, values, "creationDate", metadata.fCreation);
      readDate(runtime, values, "modifiedDate", metadata.fModified);
    }
    auto document = RNSkPDFDocument::Make(metadata);
    if (document == nullptr) {
      throw jsi::JSError(
          runtime, "PDF support is not compiled into the Skia binaries "
                   "(skia_enable_pdf is off). Rebuild the Skia binaries with "
                   "skia_enable_pdf=true in scripts/skia-configuration.ts.");
    }
    auto hostObjectInstance =
        std::make_shared<JsiSkPDFDocument>(getContext(), std::move(document));
    return JSI_CREATE_HOST_OBJECT_WITH_MEMORY_PRESSURE(
        runtime, hostObjectInstance, getContext());
#else
    throw jsi::JSError(
        runtime,
        "MakeDocument() is only available when react-native-skia is built "
        "with PDF support (SK_SUPPORT_PDF). Use Skia.PDF.isAvailable() to "
        "check at runtime.");
#endif
  }

  JSI_HOST_FUNCTION(isAvailable) {
#if defined(SK_SUPPORT_PDF)
    return jsi::Value(true);
#else
    return jsi::Value(false);
#endif
  }

  JSI_EXPORT_FUNCTIONS(JSI_EXPORT_FUNC(JsiSkPDFFactory, MakeDocument),
                       JSI_EXPORT_FUNC(JsiSkPDFFactory, isAvailable))

  size_t getMemoryPressure() const override { return 1024; }

  std::string getObjectType() const override { return "JsiSkPDFFactory"; }

  explicit JsiSkPDFFactory(std::shared_ptr<RNSkPlatformContext> context)
      : JsiSkHostObject(std::move(context)) {}

private:
  static void readString(jsi::Runtime &runtime, const jsi::Object &values,
                         const char *name, SkString &field) {
    auto value = values.getProperty(runtime, name);
    if (value.isString()) {
      field = SkString(value.asString(runtime).utf8(runtime).c_str());
    }
  }

  static void readDate(jsi::Runtime &runtime, const jsi::Object &values,
                       const char *name, SkPDF::DateTime &field) {
    auto value = values.getProperty(runtime, name);
    if (!value.isObject()) {
      return;
    }
    auto date = value.asObject(runtime);
    auto epochMs = date.getPropertyAsFunction(runtime, "getTime")
                       .callWithThis(runtime, date)
                       .asNumber();
    field = dateTimeFromEpochMilliseconds(epochMs);
  }

  /**
   * Converts epoch milliseconds (from Date.prototype.getTime) to an
   * SkPDF::DateTime expressed in UTC (fTimeZoneMinutes = 0).
   */
  static SkPDF::DateTime dateTimeFromEpochMilliseconds(double epochMs) {
    SkPDF::DateTime dateTime = {0, 0, 0, 0, 0, 0, 0, 0};
    auto seconds = static_cast<time_t>(epochMs / 1000.0);
    struct tm utc = {};
    if (gmtime_r(&seconds, &utc) == nullptr) {
      return dateTime;
    }
    dateTime.fTimeZoneMinutes = 0;
    dateTime.fYear = static_cast<uint16_t>(utc.tm_year + 1900);
    dateTime.fMonth = static_cast<uint8_t>(utc.tm_mon + 1);
    dateTime.fDayOfWeek = static_cast<uint8_t>(utc.tm_wday);
    dateTime.fDay = static_cast<uint8_t>(utc.tm_mday);
    dateTime.fHour = static_cast<uint8_t>(utc.tm_hour);
    dateTime.fMinute = static_cast<uint8_t>(utc.tm_min);
    dateTime.fSecond = static_cast<uint8_t>(utc.tm_sec);
    return dateTime;
  }
};
} // namespace RNSkia
