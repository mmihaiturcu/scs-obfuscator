#include <stdio.h>
#include <conio.h>

int main()
{
    char name[20];
    printf("Your name: ");
    scanf("%s", name);
    printf("Hello, %s!", name);
    getch();
    return 0;
}