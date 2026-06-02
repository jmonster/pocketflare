// Package cronproof validates that the PocketBase cron scheduling
// mechanism correctly identifies and runs due jobs via RunDue — the
// externally-driven method used by Pocketflare's Cloudflare Workers
// Cron Trigger integration.
package cronproof

import (
	"sync"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/tools/cron"
)

func TestRunDueSchedulesCorrectly(t *testing.T) {
	t.Parallel()

	var mu sync.Mutex
	var runs []string

	c := cron.New()

	if err := c.Add("everyHourAt5", "5 * * * *", func() {
		mu.Lock()
		runs = append(runs, "everyHourAt5")
		mu.Unlock()
	}); err != nil {
		t.Fatal(err)
	}

	if err := c.Add("everyMinute", "* * * * *", func() {
		mu.Lock()
		runs = append(runs, "everyMinute")
		mu.Unlock()
	}); err != nil {
		t.Fatal(err)
	}

	if err := c.Add("atMidnight", "0 0 * * *", func() {
		mu.Lock()
		runs = append(runs, "atMidnight")
		mu.Unlock()
	}); err != nil {
		t.Fatal(err)
	}

	// RunDue at minute 5 — only everyHourAt5 and everyMinute should fire.
	t1 := time.Date(2026, 6, 2, 14, 5, 0, 0, time.UTC)
	c.RunDue(t1)
	time.Sleep(50 * time.Millisecond)

	mu.Lock()
	if !containsAll(runs, []string{"everyHourAt5", "everyMinute"}) {
		t.Fatalf("RunDue at minute 5: expected everyHourAt5+everyMinute, got %v", runs)
	}
	if containsStr(runs, "atMidnight") {
		t.Fatalf("RunDue at minute 5: atMidnight should not have fired, got %v", runs)
	}
	mu.Unlock()

	// RunDue at minute 10 — only everyMinute should fire.
	runs = nil
	t2 := time.Date(2026, 6, 2, 14, 10, 0, 0, time.UTC)
	c.RunDue(t2)
	time.Sleep(50 * time.Millisecond)

	mu.Lock()
	if len(runs) != 1 || runs[0] != "everyMinute" {
		t.Fatalf("RunDue at minute 10: expected [everyMinute], got %v", runs)
	}
	mu.Unlock()

	// RunDue at midnight — everyMinute and atMidnight should fire.
	runs = nil
	t3 := time.Date(2026, 6, 2, 0, 0, 0, 0, time.UTC)
	c.RunDue(t3)
	time.Sleep(50 * time.Millisecond)

	mu.Lock()
	if !containsAll(runs, []string{"everyMinute", "atMidnight"}) {
		t.Fatalf("RunDue at midnight: expected everyMinute+atMidnight, got %v", runs)
	}
	if containsStr(runs, "everyHourAt5") {
		t.Fatalf("RunDue at midnight: everyHourAt5 should not have fired, got %v", runs)
	}
	mu.Unlock()
}

func containsAll(slice []string, want []string) bool {
	for _, w := range want {
		if !containsStr(slice, w) {
			return false
		}
	}
	return true
}

func containsStr(slice []string, v string) bool {
	for _, s := range slice {
		if s == v {
			return true
		}
	}
	return false
}
