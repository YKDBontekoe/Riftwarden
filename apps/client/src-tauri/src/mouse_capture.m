#import <AppKit/AppKit.h>
#import <CoreGraphics/CoreGraphics.h>
#include <pthread.h>
#include <stdbool.h>

static id monitor;
static id focusObserver;
static NSWindow *capturedWindow;
static BOOL acceptedMouseMoved;
static pthread_mutex_t movementMutex = PTHREAD_MUTEX_INITIALIZER;
static double movementX, movementY;
static bool active;

void rift_mouse_stop(void) {
    if (!monitor) return;
    [NSEvent removeMonitor:monitor];
    monitor = nil;
    [[NSNotificationCenter defaultCenter] removeObserver:focusObserver];
    focusObserver = nil;
    capturedWindow.acceptsMouseMovedEvents = acceptedMouseMoved;
    capturedWindow = nil;
    CGAssociateMouseAndMouseCursorPosition(true);
    [NSCursor unhide];
    pthread_mutex_lock(&movementMutex);
    active = false;
    movementX = movementY = 0;
    pthread_mutex_unlock(&movementMutex);
}

bool rift_mouse_start(void) {
    if (monitor) return true;
    NSWindow *window = NSApp.keyWindow;
    if (!NSApp.active || !window) return false;
    if (CGAssociateMouseAndMouseCursorPosition(false) != kCGErrorSuccess) return false;
    capturedWindow = window;
    acceptedMouseMoved = window.acceptsMouseMovedEvents;
    window.acceptsMouseMovedEvents = YES;
    NSEventMask mask = NSEventMaskMouseMoved | NSEventMaskLeftMouseDragged | NSEventMaskRightMouseDragged | NSEventMaskOtherMouseDragged;
    monitor = [NSEvent addLocalMonitorForEventsMatchingMask:mask handler:^NSEvent *(NSEvent *event) {
        if (event.window == capturedWindow) {
            pthread_mutex_lock(&movementMutex);
            movementX += event.deltaX;
            movementY += event.deltaY;
            pthread_mutex_unlock(&movementMutex);
        }
        return event;
    }];
    if (!monitor) {
        window.acceptsMouseMovedEvents = acceptedMouseMoved;
        capturedWindow = nil;
        CGAssociateMouseAndMouseCursorPosition(true);
        return false;
    }
    pthread_mutex_lock(&movementMutex);
    movementX = movementY = 0;
    active = true;
    pthread_mutex_unlock(&movementMutex);
    [NSCursor hide];
    focusObserver = [[NSNotificationCenter defaultCenter] addObserverForName:NSWindowDidResignKeyNotification object:window queue:nil usingBlock:^(__unused NSNotification *notification) {
        rift_mouse_stop();
    }];
    return true;
}

bool rift_mouse_take(double *x, double *y) {
    pthread_mutex_lock(&movementMutex);
    *x = movementX;
    *y = movementY;
    movementX = movementY = 0;
    bool captured = active;
    pthread_mutex_unlock(&movementMutex);
    return captured;
}
