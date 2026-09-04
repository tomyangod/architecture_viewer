package main

import (
	"log"
	"net/http"

	"github.com/arch-viewer/order-go/internal/catalog"
	"github.com/arch-viewer/order-go/internal/checkout"
)

func main() {
	mux := http.NewServeMux()
	mux.Handle("/catalog", catalog.Handler())
	mux.Handle("/checkout", checkout.Handler())
	log.Fatal(http.ListenAndServe(":8080", mux))
}
