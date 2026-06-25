package main

import "fmt"

type Animal interface {
	Sound() string
}

type Dog struct {
	Name string
}

func (d *Dog) Sound() string {
	return "woof"
}

func NewDog(name string) *Dog {
	return &Dog{Name: name}
}

func main() {
	dog := NewDog("Rex")
	fmt.Println(dog.Sound())
}
