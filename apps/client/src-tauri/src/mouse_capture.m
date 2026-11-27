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
static unsigned int heldButtons, pressedButtons, releasedButtons;
static double wheelY;
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
    heldButtons = pressedButtons = releasedButtons = 0;
    wheelY = 0;
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
    NSEventMask mask = NSEventMaskMouseMoved | NSEventMaskLeftMouseDragged | NSEventMaskRightMouseDragged | NSEventMaskOtherMouseDragged |
        NSEventMaskLeftMouseDown | NSEventMaskLeftMouseUp | NSEventMaskRightMouseDown | NSEventMaskRightMouseUp |
        NSEventMaskOtherMouseDown | NSEventMaskOtherMouseUp | NSEventMaskScrollWheel;
    monitor = [NSEvent addLocalMonitorForEventsMatchingMask:mask handler:^NSEvent *(NSEvent *event) {
        if (event.window == capturedWindow) {
            pthread_mutex_lock(&movementMutex);
            switch (event.type) {
                case NSEventTypeMouseMoved:
                case NSEventTypeLeftMouseDragged:
                case NSEventTypeRightMouseDragged:
                case NSEventTypeOtherMouseDragged:
                    movementX += event.deltaX;
                    movementY += event.deltaY;
                    break;
                case NSEventTypeLeftMouseDown:
                case NSEventTypeRightMouseDown:
                case NSEventTypeOtherMouseDown:
                case NSEventTypeLeftMouseUp:
                case NSEventTypeRightMouseUp:
                case NSEventTypeOtherMouseUp: {
                    NSInteger number = event.buttonNumber;
                    if (number < 0 || number > 2) break;
                    unsigned int bit = 1u << (number == 1 ? 2 : number == 2 ? 1 : 0);
                    BOOL down = event.type == NSEventTypeLeftMouseDown || event.type == NSEventTypeRightMouseDown || event.type == NSEventTypeOtherMouseDown;
                    if (down) { heldButtons |= bit; pressedButtons |= bit; }
                    else { heldButtons &= ~bit; releasedButtons |= bit; }
                    break;
                }
                case NSEventTypeScrollWheel:
                    wheelY -= event.hasPreciseScrollingDeltas ? event.scrollingDeltaY : event.deltaY * 90;
                    break;
                default: break;
            }
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
    heldButtons = pressedButtons = releasedButtons = 0;
    wheelY = 0;
    active = true;
    pthread_mutex_unlock(&movementMutex);
    [NSCursor hide];
    focusObserver = [[NSNotificationCenter defaultCenter] addObserverForName:NSWindowDidResignKeyNotification object:window queue:nil usingBlock:^(__unused NSNotification *notification) {
        rift_mouse_stop();
    }];
    return true;
}

bool rift_mouse_take(double *x, double *y, unsigned int *held, unsigned int *pressed, unsigned int *released, double *wheel) {
    pthread_mutex_lock(&movementMutex);
    *x = movementX;
    *y = movementY;
    movementX = movementY = 0;
    *held = heldButtons;
    *pressed = pressedButtons;
    *released = releasedButtons;
    *wheel = wheelY;
    pressedButtons = releasedButtons = 0;
    wheelY = 0;
    bool captured = active;
    pthread_mutex_unlock(&movementMutex);
    return captured;
}
