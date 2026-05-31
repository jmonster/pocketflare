//go:build js && wasm

package adapter

import (
	"syscall/js"

	"github.com/pocketbase/pocketbase/core"
)

var installerRedirectURLCallback js.Func

func registerInstallerBinding(app core.App) {
	installerRedirectURLCallback = js.FuncOf(func(_ js.Value, args []js.Value) any {
		requestURL := ""
		if len(args) > 0 {
			requestURL = args[0].String()
		}

		var cb js.Func
		cb = js.FuncOf(func(_ js.Value, promiseArgs []js.Value) any {
			defer cb.Release()

			resolve := promiseArgs[0]
			reject := promiseArgs[1]
			go func() {
				redirectURL, err := installerRedirectURL(app, requestURL)
				if err != nil {
					reject.Invoke(js.Global().Get("Error").New(err.Error()))
					return
				}
				resolve.Invoke(redirectURL)
			}()
			return js.Undefined()
		})

		return js.Global().Get("Promise").New(cb)
	})

	js.Global().Get("context").Get("binding").Set("installerRedirectURL", installerRedirectURLCallback)
}
