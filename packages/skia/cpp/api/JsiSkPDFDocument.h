#pragma once

#include <cstring>
#include <memory>
#include <string>
#include <utility>

#include <jsi/jsi.h>

#include "JsiSkCanvas.h"
#include "JsiSkData.h"
#include "JsiSkDispatcher.h"
#include "JsiSkNativeObjects.h"
#include "JsiSkRect.h"
#include "api/third_party/base64.h"

#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdocumentation"

#include "include/core/SkCanvas.h"
#include "include/core/SkData.h"
#include "include/core/SkDocument.h"
#include "include/core/SkStream.h"
#include "include/docs/SkPDFDocument.h"

#pragma clang diagnostic pop

namespace RNSkia {

namespace jsi = facebook::jsi;

/**
 * Plain C++ (JSI-free) wrapper around an SkPDF document. It owns the output
 * stream, tracks the document/page lifecycle explicitly and reports precise
 * errors so that the JSI layer can map them to helpful messages.
 */
class RNSkPDFDocument {
public:
  enum class State { OpenNoPage, OpenWithPage, Closed, Aborted };

  enum class Error {
    None,
    PageAlreadyOpen,
    NoPageOpen,
    AlreadyClosed,
    Aborted,
    NotClosed,
    InvalidPageSize
  };

  /**
   * Creates a new PDF document writing into an internal in-memory stream.
   * Returns nullptr when Skia could not create the document, which happens
   * when the Skia binaries were built without PDF support (skia_enable_pdf).
   */
  static std::shared_ptr<RNSkPDFDocument>
  Make(const SkPDF::Metadata &metadata) {
    auto document = std::shared_ptr<RNSkPDFDocument>(new RNSkPDFDocument());
    document->_document = SkPDF::MakeDocument(&document->_stream, metadata);
    if (document->_document == nullptr) {
      return nullptr;
    }
    return document;
  }

  ~RNSkPDFDocument() {
    // Abort a still-open document before dropping it - ~SkDocument would
    // otherwise run a full implicit close(), which is needlessly expensive
    // when the output is about to be thrown away (e.g. on GC).
    if (_state == State::OpenNoPage || _state == State::OpenWithPage) {
      _document->abort();
    }
  }

  std::pair<Error, SkCanvas *> beginPage(SkScalar width, SkScalar height,
                                         const SkRect *contentRect) {
    switch (_state) {
    case State::OpenWithPage:
      return {Error::PageAlreadyOpen, nullptr};
    case State::Closed:
      return {Error::AlreadyClosed, nullptr};
    case State::Aborted:
      return {Error::Aborted, nullptr};
    case State::OpenNoPage:
      break;
    }
    if (!(width > 0 && height > 0)) {
      return {Error::InvalidPageSize, nullptr};
    }
    auto *canvas = _document->beginPage(width, height, contentRect);
    if (canvas == nullptr) {
      // Unexpected: the document rejected the page even though our state
      // machine and size validation allowed it.
      return {Error::None, nullptr};
    }
    _state = State::OpenWithPage;
    return {Error::None, canvas};
  }

  Error endPage() {
    switch (_state) {
    case State::OpenNoPage:
      return Error::NoPageOpen;
    case State::Closed:
      return Error::AlreadyClosed;
    case State::Aborted:
      return Error::Aborted;
    case State::OpenWithPage:
      break;
    }
    _document->endPage();
    _state = State::OpenNoPage;
    return Error::None;
  }

  Error close() {
    switch (_state) {
    case State::OpenWithPage:
      return Error::PageAlreadyOpen;
    case State::Closed:
      return Error::AlreadyClosed;
    case State::Aborted:
      return Error::Aborted;
    case State::OpenNoPage:
      break;
    }
    _document->close();
    _result = _stream.detachAsData();
    _document = nullptr;
    _state = State::Closed;
    return Error::None;
  }

  Error abort() {
    switch (_state) {
    case State::Aborted:
      // Aborting an already aborted document is a no-op.
      return Error::None;
    case State::Closed:
      return Error::AlreadyClosed;
    case State::OpenNoPage:
    case State::OpenWithPage:
      break;
    }
    _document->abort();
    _document = nullptr;
    _stream.reset();
    _state = State::Aborted;
    return Error::None;
  }

  sk_sp<SkData> getResult() const { return _result; }

  State state() const { return _state; }

private:
  RNSkPDFDocument() = default;

  // _stream is declared before _document so it is destroyed last - the
  // document may still reference the stream while being torn down.
  SkDynamicMemoryWStream _stream;
  sk_sp<SkDocument> _document;
  State _state = State::OpenNoPage;
  sk_sp<SkData> _result;
};

/**
 * Canvas handed out by JsiSkPDFDocument::beginPage. It stays valid only while
 * its page is open: once the page ends the canvas is detached from the
 * (document-owned and now destroyed) SkCanvas and redirected at a throwaway
 * sink, so drawing into a finished page is a harmless no-op rather than a
 * write through a dangling pointer.
 *
 * It deliberately reuses the shared "Canvas" prototype instead of declaring a
 * NativeObject class of its own: every SkCanvas method - including ones added
 * upstream later - keeps working, and draw calls stay on the fast prototype
 * path. Resolving the instance works because jsi::Object::getNativeState<T>
 * dynamic-casts, and this class derives from JsiSkCanvas.
 *
 * Note: under the pre-2.10 HostObject API this class intercepted every
 * property access and threw a descriptive error after the page had ended.
 * Property interception no longer exists in the native-state design (and
 * reintroducing a per-call guard would tax the hottest path in the library),
 * so stale draws are now silently discarded instead of throwing.
 */
class JsiSkPDFPageCanvas : public JsiSkCanvas {
public:
  JsiSkPDFPageCanvas(std::shared_ptr<RNSkPlatformContext> context,
                     SkCanvas *pageCanvas,
                     std::shared_ptr<RNSkPDFDocument> owner)
      : JsiSkCanvas(std::move(context), pageCanvas), _owner(std::move(owner)) {}

  void invalidate() {
    // Point at a harmless empty canvas so that any reference JS still holds
    // draws into the void instead of into a dangling page canvas.
    setCanvas(&_sink);
    _owner.reset();
  }

private:
  SkCanvas _sink;
  std::shared_ptr<RNSkPDFDocument> _owner;
};

class JsiSkPDFDocument
    : public JsiSkWrappingSharedPtrNativeObject<JsiSkPDFDocument,
                                                RNSkPDFDocument> {
private:
  std::shared_ptr<Dispatcher> _dispatcher;
  std::shared_ptr<JsiSkPDFPageCanvas> _pageCanvas;

public:
  static constexpr const char *CLASS_NAME = "PDFDocument";

  JsiSkPDFDocument(std::shared_ptr<RNSkPlatformContext> context,
                   std::shared_ptr<RNSkPDFDocument> document)
      : JsiSkWrappingSharedPtrNativeObject<JsiSkPDFDocument, RNSkPDFDocument>(
            std::move(context), std::move(document)) {
    // Get the dispatcher for the current thread
    _dispatcher = Dispatcher::getDispatcher();
    // Process any pending operations
    _dispatcher->processQueue();
  }

  ~JsiSkPDFDocument() override {
    if (!isDisposed()) {
      // This JSI Object is being deleted from a GC, which might happen on a
      // separate Thread. The underlying document must be torn down on the
      // Thread it was created on, so we ship the last references there.
      // RNSkPDFDocument aborts any still-open document in its destructor.
      auto document = getObjectUnchecked();
      auto pageCanvas = _pageCanvas;
      if (_dispatcher && (document || pageCanvas)) {
        _dispatcher->run([document, pageCanvas]() {
          if (pageCanvas) {
            pageCanvas->invalidate();
          }
          // The document and page canvas are released when this lambda is
          // destroyed, on the original Thread.
        });
      }
      _pageCanvas = nullptr;
      setObject(nullptr);
    }
  }

  JSI_HOST_FUNCTION(beginPage) {
    auto width = static_cast<SkScalar>(
        getArgumentAsNumber(runtime, arguments, count, 0));
    auto height = static_cast<SkScalar>(
        getArgumentAsNumber(runtime, arguments, count, 1));
    std::shared_ptr<SkRect> contentRect;
    if (count > 2 && !arguments[2].isUndefined() && !arguments[2].isNull()) {
      contentRect = JsiSkRect::fromValue(runtime, arguments[2]);
    }
    auto document = getObject();
    auto result = document->beginPage(width, height, contentRect.get());
    switch (result.first) {
    case RNSkPDFDocument::Error::PageAlreadyOpen:
      throw jsi::JSError(runtime,
                         "beginPage() failed: a page is already open. Call "
                         "endPage() before starting a new page.");
    case RNSkPDFDocument::Error::InvalidPageSize:
      throw jsi::JSError(runtime,
                         "beginPage() failed: width and height must be > 0.");
    case RNSkPDFDocument::Error::AlreadyClosed:
      throw jsi::JSError(
          runtime,
          "This PDF document is closed. No further pages can be added.");
    case RNSkPDFDocument::Error::Aborted:
      throw jsi::JSError(
          runtime, "This PDF document was aborted and can no longer be used.");
    default:
      break;
    }
    if (result.second == nullptr) {
      throw jsi::JSError(
          runtime,
          "beginPage() failed: Skia could not create the page canvas.");
    }
    _pageCanvas = std::make_shared<JsiSkPDFPageCanvas>(getContext(),
                                                       result.second, document);
    // Hand it out under the shared Canvas prototype - see JsiSkPDFPageCanvas.
    return makeJsiObject<JsiSkCanvas>(runtime, _pageCanvas);
  }

  JSI_HOST_FUNCTION(endPage) {
    auto document = getObject();
    switch (document->state()) {
    case RNSkPDFDocument::State::OpenNoPage:
      throw jsi::JSError(
          runtime,
          "endPage() failed: no page is open. Call beginPage() first.");
    case RNSkPDFDocument::State::Closed:
      throw jsi::JSError(
          runtime,
          "This PDF document is closed. No further pages can be added.");
    case RNSkPDFDocument::State::Aborted:
      throw jsi::JSError(
          runtime, "This PDF document was aborted and can no longer be used.");
    case RNSkPDFDocument::State::OpenWithPage:
      break;
    }
    // Detach the JS-facing canvas before Skia destroys the page canvas.
    invalidatePageCanvas();
    document->endPage();
    return jsi::Value::undefined();
  }

  JSI_HOST_FUNCTION(close) {
    auto document = getObject();
    switch (document->state()) {
    case RNSkPDFDocument::State::OpenWithPage:
      throw jsi::JSError(runtime, "close() failed: a page is still open. Call "
                                  "endPage() before closing the document.");
    case RNSkPDFDocument::State::Aborted:
      throw jsi::JSError(
          runtime, "This PDF document was aborted and can no longer be used.");
    case RNSkPDFDocument::State::Closed:
      // close() is idempotent: return the cached bytes.
      return resultToUint8Array(runtime, document);
    case RNSkPDFDocument::State::OpenNoPage:
      break;
    }
    invalidatePageCanvas();
    document->close();
    return resultToUint8Array(runtime, document);
  }

  JSI_HOST_FUNCTION(makeData) {
    auto document = getObject();
    if (document->state() != RNSkPDFDocument::State::Closed) {
      throw jsi::JSError(runtime,
                         "The PDF document is not finished. Call close() "
                         "before reading the output.");
    }
    return makeJsiObject(runtime, std::make_shared<JsiSkData>(
                                      getContext(), document->getResult()));
  }

  JSI_HOST_FUNCTION(getBase64) {
    auto document = getObject();
    if (document->state() != RNSkPDFDocument::State::Closed) {
      throw jsi::JSError(runtime,
                         "The PDF document is not finished. Call close() "
                         "before reading the output.");
    }
    auto data = document->getResult();
    auto len = Base64::Encode(data->bytes(), data->size(), nullptr);
    auto buffer = std::string(len, 0);
    Base64::Encode(data->bytes(), data->size(),
                   reinterpret_cast<void *>(&buffer[0]));
    return jsi::String::createFromAscii(runtime, buffer);
  }

  JSI_HOST_FUNCTION(abort) {
    auto document = getObject();
    if (document->state() == RNSkPDFDocument::State::Closed) {
      throw jsi::JSError(runtime,
                         "abort() failed: the document is already closed.");
    }
    invalidatePageCanvas();
    document->abort();
    return jsi::Value::undefined();
  }

  JSI_PROPERTY_GET(state) {
    const char *state = "open";
    switch (getObject()->state()) {
    case RNSkPDFDocument::State::OpenNoPage:
      state = "open";
      break;
    case RNSkPDFDocument::State::OpenWithPage:
      state = "page-open";
      break;
    case RNSkPDFDocument::State::Closed:
      state = "closed";
      break;
    case RNSkPDFDocument::State::Aborted:
      state = "aborted";
      break;
    }
    return jsi::String::createFromUtf8(runtime, state);
  }

  static void definePrototype(jsi::Runtime &runtime, jsi::Object &prototype) {
    // installCommon installs dispose(); __typename__ ("PDFDocument") and
    // __box() are installed by NativeObject::installPrototype.
    installCommon(runtime, prototype);
    installHostMethod(runtime, prototype, "beginPage",
                      &JsiSkPDFDocument::beginPage);
    installHostMethod(runtime, prototype, "endPage",
                      &JsiSkPDFDocument::endPage);
    installHostMethod(runtime, prototype, "close", &JsiSkPDFDocument::close);
    installHostMethod(runtime, prototype, "makeData",
                      &JsiSkPDFDocument::makeData);
    installHostMethod(runtime, prototype, "getBase64",
                      &JsiSkPDFDocument::getBase64);
    installHostMethod(runtime, prototype, "abort", &JsiSkPDFDocument::abort);
    installHostGetter(runtime, prototype, "state",
                      &JsiSkPDFDocument::get_state);
  }

  size_t getMemoryPressure() override { return 1024 * 1024; }

protected:
  void releaseResources() override {
    invalidatePageCanvas();
    auto document = getObjectUnchecked();
    if (document) {
      auto state = document->state();
      if (state == RNSkPDFDocument::State::OpenNoPage ||
          state == RNSkPDFDocument::State::OpenWithPage) {
        document->abort();
      }
    }
    setObject(nullptr);
  }

private:
  void invalidatePageCanvas() {
    if (_pageCanvas) {
      _pageCanvas->invalidate();
      _pageCanvas = nullptr;
    }
  }

  jsi::Value
  resultToUint8Array(jsi::Runtime &runtime,
                     const std::shared_ptr<RNSkPDFDocument> &document) {
    auto data = document->getResult();
    if (data == nullptr) {
      throw jsi::JSError(
          runtime, "close() failed: Skia did not produce any PDF output.");
    }
    auto arrayCtor =
        runtime.global().getPropertyAsFunction(runtime, "Uint8Array");
    size_t size = data->size();

    jsi::Object array =
        arrayCtor.callAsConstructor(runtime, static_cast<double>(size))
            .getObject(runtime);
    jsi::ArrayBuffer buffer =
        array.getProperty(runtime, jsi::PropNameID::forAscii(runtime, "buffer"))
            .asObject(runtime)
            .getArrayBuffer(runtime);

    auto bfrPtr = reinterpret_cast<uint8_t *>(buffer.data(runtime));
    memcpy(bfrPtr, data->bytes(), size);
    return array;
  }
};
} // namespace RNSkia
